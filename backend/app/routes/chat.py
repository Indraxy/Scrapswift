"""Real-time / polling chat router between Collectors and Recyclers."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, and_, desc
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ChatMessage, Collector, Lot, Recycler, User
from ..schemas.schemas import ChatMessageIn, ChatMessageOut, ChatThreadOut
from ..services.security import current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


class MarkReadIn(BaseModel):
    with_user_id: int
    lot_id: Optional[str] = None


def _format_message(msg: ChatMessage, db: Session) -> dict:
    sender = db.get(User, msg.sender_id)
    receiver = db.get(User, msg.receiver_id)
    return {
        "message_id": msg.message_id,
        "lot_id": msg.lot_id,
        "sender_id": msg.sender_id,
        "sender_name": sender.name if sender else f"User {msg.sender_id}",
        "sender_role": sender.role if sender else "user",
        "receiver_id": msg.receiver_id,
        "receiver_name": receiver.name if receiver else f"User {msg.receiver_id}",
        "content": msg.content,
        "message_type": msg.message_type,
        "is_read": msg.is_read,
        "created_at": msg.created_at,
    }


@router.get("/threads", response_model=List[ChatThreadOut])
def list_threads(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """List all active chat conversations for the signed-in user."""
    # Find all messages where user is sender or receiver
    messages = (
        db.query(ChatMessage)
        .filter(or_(ChatMessage.sender_id == user.id, ChatMessage.receiver_id == user.id))
        .order_by(desc(ChatMessage.created_at))
        .all()
    )

    # Group by (other_user_id, lot_id)
    threads_map = {}
    for msg in messages:
        other_user_id = msg.receiver_id if msg.sender_id == user.id else msg.sender_id
        thread_key = f"{other_user_id}_{msg.lot_id or 'general'}"
        
        if thread_key not in threads_map:
            threads_map[thread_key] = {
                "latest_msg": msg,
                "other_user_id": other_user_id,
                "lot_id": msg.lot_id,
                "unread_count": 0,
            }
        
        # Count unread messages received by current user
        if msg.receiver_id == user.id and not msg.is_read:
            threads_map[thread_key]["unread_count"] += 1

    out = []
    for key, data in threads_map.items():
        other_u = db.get(User, data["other_user_id"])
        if not other_u:
            continue
        
        contact = ""
        if other_u.role == "recycler":
            rec = db.query(Recycler).filter(Recycler.user_id == other_u.id).first()
            if rec:
                contact = rec.contact or rec.location
        elif other_u.role == "collector":
            col = db.query(Collector).filter(Collector.user_id == other_u.id).first()
            if col:
                contact = col.operating_location

        lot_cat = ""
        lot_w = None
        if data["lot_id"]:
            lot_obj = db.query(Lot).filter(Lot.lot_id == data["lot_id"]).first()
            if lot_obj:
                lot_cat = lot_obj.material_category
                lot_w = lot_obj.weight

        out.append(
            ChatThreadOut(
                thread_id=key,
                lot_id=data["lot_id"],
                other_user_id=data["other_user_id"],
                other_user_name=other_u.name,
                other_user_role=other_u.role,
                other_user_contact=contact,
                lot_category=lot_cat,
                lot_weight=lot_w,
                last_message=data["latest_msg"].content,
                last_message_at=data["latest_msg"].created_at,
                unread_count=data["unread_count"],
            )
        )

    # Sort threads by latest message timestamp
    out.sort(key=lambda x: x.last_message_at or datetime.min, reverse=True)
    return out


@router.get("/messages", response_model=List[ChatMessageOut])
def get_messages(
    with_user_id: int = Query(...),
    lot_id: Optional[str] = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Retrieve message history between current user and specified user."""
    query = db.query(ChatMessage).filter(
        or_(
            and_(ChatMessage.sender_id == user.id, ChatMessage.receiver_id == with_user_id),
            and_(ChatMessage.sender_id == with_user_id, ChatMessage.receiver_id == user.id),
        )
    )

    if lot_id:
        query = query.filter(ChatMessage.lot_id == lot_id)

    rows = query.order_by(ChatMessage.created_at.asc()).limit(200).all()

    # Automatically mark received messages as read
    unread_ids = [m.message_id for m in rows if m.receiver_id == user.id and not m.is_read]
    if unread_ids:
        db.query(ChatMessage).filter(ChatMessage.message_id.in_(unread_ids)).update(
            {"is_read": True}, synchronize_session=False
        )
        db.commit()

    return [_format_message(m, db) for m in rows]


@router.post("/messages", response_model=ChatMessageOut)
def send_message(
    payload: ChatMessageIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Send a message to another user."""
    receiver = db.get(User, payload.receiver_id)
    if not receiver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receiver not found")

    if payload.receiver_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot send message to yourself"
        )

    msg = ChatMessage(
        lot_id=payload.lot_id,
        sender_id=user.id,
        receiver_id=payload.receiver_id,
        content=payload.content.strip(),
        message_type=payload.message_type,
        is_read=False,
        created_at=datetime.utcnow(),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _format_message(msg, db)


@router.post("/read")
def mark_read(
    payload: MarkReadIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Explicitly mark a conversation thread as read."""
    query = db.query(ChatMessage).filter(
        ChatMessage.sender_id == payload.with_user_id,
        ChatMessage.receiver_id == user.id,
        ChatMessage.is_read.is_(False),
    )
    if payload.lot_id:
        query = query.filter(ChatMessage.lot_id == payload.lot_id)

    updated = query.update({"is_read": True}, synchronize_session=False)
    db.commit()
    return {"marked_read": updated}
