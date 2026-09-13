from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import ChatMessage, Collector, Lot, Recycler, User
from ..schemas.schemas import ChatMessageIn, ChatMessageOut, ChatThreadOut
from ..services.security import current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _collector_for(db: Session, user: User) -> Collector | None:
    if user.role != "collector":
        return None
    return db.query(Collector).filter(Collector.user_id == user.id).first()


def _recycler_for(db: Session, user: User) -> Recycler | None:
    if user.role != "recycler":
        return None
    return db.query(Recycler).filter(Recycler.user_id == user.id).first()


def _get_lot_and_verify(db: Session, lot_id: str, user: User) -> tuple[Lot, Collector, Recycler]:
    lot = db.query(Lot).filter(Lot.lot_id == lot_id).first()
    if not lot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No lot with ID {lot_id}")

    collector = db.get(Collector, lot.collector_id)
    if not collector:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collector record not found")

    if not lot.recycler_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No recycler has been selected for this lot yet. Please select a recycler first.",
        )

    recycler = db.get(Recycler, lot.recycler_id)
    if not recycler:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Selected recycler record not found")

    # Authorization checks
    if user.role == "collector":
        col = _collector_for(db, user)
        if not col or col.collector_id != lot.collector_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied: you do not own this lot")
    elif user.role == "recycler":
        rec = _recycler_for(db, user)
        if rec and rec.recycler_id != lot.recycler_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Access denied: this lot is assigned to another recycler"
            )

    return lot, collector, recycler


@router.get("/threads", response_model=list[ChatThreadOut])
def get_chat_threads(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """List all active chat conversations for the logged in user."""
    threads: list[ChatThreadOut] = []

    if user.role == "collector":
        col = _collector_for(db, user)
        if not col:
            return []
        lots = (
            db.query(Lot)
            .filter(Lot.collector_id == col.collector_id, Lot.recycler_id.isnot(None))
            .order_by(Lot.updated_at.desc())
            .all()
        )
        for l in lots:
            rec = db.get(Recycler, l.recycler_id)
            if not rec:
                continue
            last_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.lot_id == l.lot_id)
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            unread = (
                db.query(ChatMessage)
                .filter(
                    ChatMessage.lot_id == l.lot_id,
                    ChatMessage.read == False,
                    ChatMessage.sender_role != "collector",
                )
                .count()
            )
            threads.append(
                ChatThreadOut(
                    lot_id=l.lot_id,
                    material_category=l.material_category,
                    weight=l.weight,
                    status=l.status,
                    collector_name=col.display_name,
                    recycler_name=rec.name,
                    counterpart_name=rec.name,
                    counterpart_role="recycler",
                    last_message=last_msg.message if last_msg else "Tap to start conversation",
                    last_message_at=last_msg.created_at if last_msg else l.updated_at,
                    unread_count=unread,
                )
            )

    elif user.role == "recycler":
        rec = _recycler_for(db, user)
        query = db.query(Lot).filter(Lot.recycler_id.isnot(None))
        if rec:
            query = query.filter(Lot.recycler_id == rec.recycler_id)
        lots = query.order_by(Lot.updated_at.desc()).all()

        for l in lots:
            col = db.get(Collector, l.collector_id)
            rec_entity = db.get(Recycler, l.recycler_id)
            if not col or not rec_entity:
                continue
            last_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.lot_id == l.lot_id)
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            unread = (
                db.query(ChatMessage)
                .filter(
                    ChatMessage.lot_id == l.lot_id,
                    ChatMessage.read == False,
                    ChatMessage.sender_role == "collector",
                )
                .count()
            )
            threads.append(
                ChatThreadOut(
                    lot_id=l.lot_id,
                    material_category=l.material_category,
                    weight=l.weight,
                    status=l.status,
                    collector_name=col.display_name,
                    recycler_name=rec_entity.name,
                    counterpart_name=col.display_name,
                    counterpart_role="collector",
                    last_message=last_msg.message if last_msg else "New match assigned",
                    last_message_at=last_msg.created_at if last_msg else l.updated_at,
                    unread_count=unread,
                )
            )

    return threads


@router.get("/{lot_id}/messages", response_model=list[ChatMessageOut])
def get_lot_messages(
    lot_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Retrieve all messages for this lot, inserting an initial greeting if thread is new."""
    lot, collector, recycler = _get_lot_and_verify(db, lot_id, user)

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.lot_id == lot_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    if not messages:
        # Seed an initial welcome message from the recycler to kick off the thread
        rate = (recycler.offered_rate or {}).get(lot.material_category, 0)
        welcome = ChatMessage(
            lot_id=lot.lot_id,
            collector_id=collector.collector_id,
            recycler_id=recycler.recycler_id,
            sender_id=recycler.user_id,
            sender_role="recycler",
            sender_name=recycler.name,
            message=(
                f"Namaste {collector.display_name}! Thank you for selecting {recycler.name} for "
                f"Lot #{lot.lot_id} ({lot.weight} kg {lot.material_category}). "
                f"Our quoted rate is ₹{rate}/kg. When is a good time for pickup?"
            ),
            quick_action="GREETING",
            read=False,
            created_at=datetime.utcnow(),
        )
        db.add(welcome)
        db.commit()
        db.refresh(welcome)
        messages = [welcome]

    return messages


@router.post("/{lot_id}/messages", response_model=ChatMessageOut)
def send_lot_message(
    lot_id: str,
    payload: ChatMessageIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Send a message on this lot's conversation thread."""
    lot, collector, recycler = _get_lot_and_verify(db, lot_id, user)

    sender_role = user.role if user.role in ("collector", "recycler") else "collector"
    sender_name = user.name or (
        collector.display_name if sender_role == "collector" else recycler.name
    )

    msg = ChatMessage(
        lot_id=lot.lot_id,
        collector_id=collector.collector_id,
        recycler_id=recycler.recycler_id,
        sender_id=user.id,
        sender_role=sender_role,
        sender_name=sender_name,
        message=payload.message.strip(),
        quick_action=payload.quick_action or "",
        read=False,
        created_at=datetime.utcnow(),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # If the sender is a collector and this is an automated assist:
    if sender_role == "collector":
        _maybe_auto_reply(db, lot, collector, recycler, payload.message.lower(), payload.quick_action)

    return msg


def _maybe_auto_reply(
    db: Session,
    lot: Lot,
    collector: Collector,
    recycler: Recycler,
    text: str,
    quick_action: str | None,
):
    """Provide realistic automated recycler responses for logistical coordination."""
    reply_text = ""
    action = ""

    rate = (recycler.offered_rate or {}).get(lot.material_category, 0)
    total_val = round(rate * lot.weight) if rate else lot.quoted_price

    if quick_action == "TIME" or any(w in text for w in ("time", "when", "pickup", "kab", "aayenge", "schedule")):
        reply_text = (
            f"Got it! Our pickup van will arrive at your location ({lot.location or 'your registered area'}) "
            f"tomorrow between 10:00 AM and 1:00 PM. Please keep the {lot.weight} kg material ready."
        )
        action = "PICKUP_SCHEDULED"
    elif quick_action == "LOCATION" or any(w in text for w in ("location", "address", "pata", "map", "directions")):
        reply_text = (
            f"Location acknowledged. Driver will navigate to {lot.location or 'your registered location'}. "
            "We will call you 15 minutes prior to arrival."
        )
        action = "LOCATION_CONFIRMED"
    elif quick_action == "RATE" or any(w in text for w in ("rate", "price", "paisa", "rupee", "amount", "final")):
        reply_text = (
            f"Rate confirmed! ₹{rate}/kg for {lot.material_category} is locked in. "
            f"Estimated total payout is ₹{total_val}. Payment will be released via cash or UPI right at handover."
        )
        action = "RATE_CONFIRMED"
    elif quick_action == "READY" or any(w in text for w in ("ready", "packed", "prepared", "inspect")):
        reply_text = (
            f"Great! We'll inspect the {lot.material_category} on our certified digital scales. "
            "Make sure to keep your QR code ready on screen for our agent to scan."
        )
        action = "INSPECTION_READY"
    else:
        reply_text = (
            f"Message received regarding Lot #{lot.lot_id}. Our logistics desk is on it, "
            "and we will coordinate with you shortly!"
        )

    if reply_text:
        auto_msg = ChatMessage(
            lot_id=lot.lot_id,
            collector_id=collector.collector_id,
            recycler_id=recycler.recycler_id,
            sender_id=recycler.user_id,
            sender_role="recycler",
            sender_name=recycler.name,
            message=reply_text,
            quick_action=action,
            read=False,
            created_at=datetime.utcnow(),
        )
        db.add(auto_msg)
        db.commit()


@router.patch("/{lot_id}/read")
def mark_lot_messages_read(
    lot_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Mark all incoming unread messages for this lot as read."""
    lot, _, _ = _get_lot_and_verify(db, lot_id, user)
    opposing_role = "recycler" if user.role == "collector" else "collector"
    unread_msgs = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.lot_id == lot.lot_id,
            ChatMessage.sender_role == opposing_role,
            ChatMessage.read == False,
        )
        .all()
    )
    for m in unread_msgs:
        m.read = True
    db.commit()
    return {"marked_read": len(unread_msgs)}
