"""Recycler offers on open lots (Phase 4).

Flow:
    collector creates lot  ->  it appears in every eligible recycler's
    "open lots"  ->  recycler posts an offer  ->  collector sees the offers on
    the lot  ->  collector accepts one.

Accepting reuses exactly the same assignment the direct "choose this recycler"
path performs, so a lot always ends up with one Transaction and the existing
handover/payment/earnings code is untouched.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Lot, Offer, Recycler, Transaction, User
from ..schemas.schemas import OfferIn, OfferOut
from ..services import matching
from ..services.common import lot_dict, log_event
from ..services.security import collector_for, current_user, recycler_for, require_role

router = APIRouter(prefix="/api", tags=["offers"])

OPEN_STATUSES = ("LOT_CREATED", "PRICE_ESTIMATED")


def _offer_out(db: Session, offer: Offer, lot: Lot | None = None) -> dict:
    rec = db.get(Recycler, offer.recycler_id)
    lot = lot or db.query(Lot).filter(Lot.lot_id == offer.lot_id).first()
    distance = (
        matching.haversine_km(lot.latitude, lot.longitude, rec.latitude, rec.longitude)
        if lot and rec else None
    )
    return {
        "offer_id": offer.offer_id,
        "lot_id": offer.lot_id,
        "recycler_id": offer.recycler_id,
        "recycler_name": rec.name if rec else None,
        "recycler_location": rec.location if rec else None,
        "authorization_id": rec.authorization_id if rec else None,
        "pickup_offered": offer.pickup_offered,
        "distance_km": distance,
        "rate_per_kg": offer.rate_per_kg,
        "amount": offer.amount,
        "note": offer.note,
        "status": offer.status,
        "created_at": offer.created_at,
    }


@router.get("/recyclers/me/open-lots")
def open_lots(user: User = Depends(require_role("recycler")), db: Session = Depends(get_db)):
    """Lots with no recycler yet that this facility could take."""
    rec = recycler_for(db, user)
    rows = (
        db.query(Lot)
        .filter(Lot.status.in_(OPEN_STATUSES), Lot.recycler_id.is_(None))
        .order_by(Lot.created_at.desc())
        .limit(60)
        .all()
    )
    accepted = set(rec.accepted_materials or [])
    out = []
    for lot in rows:
        # "Other" has no published rate, so any authorised facility may bid.
        if lot.material_category != "Other" and lot.material_category not in accepted:
            continue
        distance = matching.haversine_km(lot.latitude, lot.longitude, rec.latitude, rec.longitude)
        if distance > max(rec.service_area_km, 5) * 1.5:
            continue
        mine = (
            db.query(Offer)
            .filter(Offer.lot_id == lot.lot_id, Offer.recycler_id == rec.recycler_id,
                    Offer.status == "PENDING")
            .first()
        )
        out.append({
            **lot_dict(db, lot),
            "distance_km": distance,
            "suggested_rate": float((rec.offered_rate or {}).get(lot.material_category, 0)),
            "offer_count": db.query(Offer).filter(
                Offer.lot_id == lot.lot_id, Offer.status == "PENDING").count(),
            "my_offer": _offer_out(db, mine, lot) if mine else None,
        })
    return out


@router.post("/lots/{lot_id}/offers", status_code=201, response_model=OfferOut)
def make_offer(
    lot_id: str,
    payload: OfferIn,
    user: User = Depends(require_role("recycler")),
    db: Session = Depends(get_db),
):
    rec = recycler_for(db, user)
    if rec.authorization_status != "approved":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only authorised facilities can make offers")
    lot = db.query(Lot).filter(Lot.lot_id == lot_id).first()
    if not lot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No lot with ID {lot_id}")
    if lot.status not in OPEN_STATUSES or lot.recycler_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This lot is no longer open for offers")
    if lot.material_category != "Other" and lot.material_category not in (rec.accepted_materials or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Your facility does not accept {lot.material_category}")

    existing = (
        db.query(Offer)
        .filter(Offer.lot_id == lot_id, Offer.recycler_id == rec.recycler_id,
                Offer.status == "PENDING")
        .first()
    )
    amount = round(payload.rate_per_kg * lot.weight)
    if existing:
        # One live offer per facility per lot — revising replaces it.
        existing.rate_per_kg = payload.rate_per_kg
        existing.amount = amount
        existing.note = payload.note
        existing.pickup_offered = payload.pickup_offered
        existing.updated_at = datetime.utcnow()
        offer = existing
        log_event(db, lot_id, "OFFER_RECEIVED",
                  f"{rec.name} revised to ₹{payload.rate_per_kg:.0f}/kg", actor=rec.name)
    else:
        offer = Offer(
            lot_id=lot_id, recycler_id=rec.recycler_id, rate_per_kg=payload.rate_per_kg,
            amount=amount, note=payload.note, pickup_offered=payload.pickup_offered,
            status="PENDING",
        )
        db.add(offer)
        log_event(db, lot_id, "OFFER_RECEIVED",
                  f"{rec.name} offered ₹{payload.rate_per_kg:.0f}/kg (₹{amount:.0f})",
                  actor=rec.name)
    db.commit()
    db.refresh(offer)
    return _offer_out(db, offer, lot)


@router.get("/lots/{lot_id}/offers")
def offers_for_lot(lot_id: str, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    lot = db.query(Lot).filter(Lot.lot_id == lot_id).first()
    if not lot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No lot with ID {lot_id}")
    if user.role == "collector":
        collector = collector_for(db, user)
        if lot.collector_id != collector.collector_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This lot belongs to another collector")
    elif user.role == "recycler":
        rec = recycler_for(db, user)
        rows = db.query(Offer).filter(Offer.lot_id == lot_id,
                                      Offer.recycler_id == rec.recycler_id).all()
        return [_offer_out(db, o, lot) for o in rows]
    rows = (
        db.query(Offer).filter(Offer.lot_id == lot_id)
        .order_by(Offer.rate_per_kg.desc()).all()
    )
    return [_offer_out(db, o, lot) for o in rows]


@router.get("/offers")
def my_offers(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Collector: every pending offer across my open lots.
       Recycler: every offer I have made."""
    if user.role == "recycler":
        rec = recycler_for(db, user)
        rows = (
            db.query(Offer).filter(Offer.recycler_id == rec.recycler_id)
            .order_by(Offer.created_at.desc()).limit(100).all()
        )
        return [_offer_out(db, o) for o in rows]
    collector = collector_for(db, user)
    lot_ids = [
        l.lot_id for l in db.query(Lot).filter(Lot.collector_id == collector.collector_id).all()
    ]
    rows = (
        db.query(Offer)
        .filter(Offer.lot_id.in_(lot_ids), Offer.status == "PENDING")
        .order_by(Offer.created_at.desc()).all()
    )
    return [_offer_out(db, o) for o in rows]


@router.post("/offers/{offer_id}/accept")
def accept_offer(offer_id: int, user: User = Depends(require_role("collector")),
                 db: Session = Depends(get_db)):
    collector = collector_for(db, user)
    offer = db.get(Offer, offer_id)
    if not offer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    lot = db.query(Lot).filter(Lot.lot_id == offer.lot_id).first()
    if not lot or lot.collector_id != collector.collector_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This lot belongs to another collector")
    if offer.status != "PENDING":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Offer is already {offer.status}")
    if lot.status not in OPEN_STATUSES or lot.recycler_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This lot already has a recycler")

    rec = db.get(Recycler, offer.recycler_id)
    if not rec or rec.authorization_status != "approved":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "That recycler is not authorised on the platform")

    # Same assignment the direct-selection path makes.
    lot.recycler_id = rec.recycler_id
    lot.quoted_price = offer.amount
    ranked = {m["recycler"].recycler_id: m for m in matching.match_recyclers(db, lot, limit=20)}
    picked = ranked.get(rec.recycler_id)
    lot.match_score = picked["match_score"] if picked else 0
    lot.status = "HANDOVER_PENDING"

    offer.status = "ACCEPTED"
    offer.updated_at = datetime.utcnow()
    for other in db.query(Offer).filter(Offer.lot_id == lot.lot_id,
                                        Offer.offer_id != offer.offer_id,
                                        Offer.status == "PENDING").all():
        other.status = "DECLINED"
        other.updated_at = datetime.utcnow()

    txn = Transaction(
        lot_id=lot.lot_id, collector_id=lot.collector_id, recycler_id=rec.recycler_id,
        quoted_price=offer.amount, collection_location=lot.location,
        transaction_status="RECYCLER_MATCHED", payment_status="PENDING",
    )
    db.add(txn)
    log_event(db, lot.lot_id, "OFFER_ACCEPTED",
              f"{rec.name} at ₹{offer.rate_per_kg:.0f}/kg (₹{offer.amount:.0f})",
              actor=collector.display_name)
    log_event(db, lot.lot_id, "RECYCLER_MATCHED", f"{rec.name} accepted by collector",
              actor=collector.display_name)
    log_event(db, lot.lot_id, "HANDOVER_PENDING", "Waiting for recycler to scan the lot QR")
    db.commit()
    db.refresh(lot)
    return {
        **lot_dict(db, lot),
        "qr_payload": f"/verify/{lot.lot_id}",
        "transaction_id": txn.transaction_id,
        "accepted_offer": _offer_out(db, offer, lot),
    }
