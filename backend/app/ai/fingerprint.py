"""Perceptual Image Fingerprinting & Duplicate Fraud Detection.

Uses 64-bit gradient Difference Hash (dHash).
Unlike cryptographic hashes (SHA-256) which break with a single changed byte,
a perceptual fingerprint is invariant to:
  - JPEG / WhatsApp recompression
  - Resizing & downsampling
  - Minor brightness / contrast shifts
  - Minor angle crops

If the Hamming distance between two image fingerprints is <= 6 bits
(meaning >90% visual similarity), the system flags the photo as a duplicate.
"""
from __future__ import annotations

import io
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def compute_fingerprint(image_bytes: bytes) -> str:
    """Compute a 64-bit difference hash (16-char hex string) from raw image bytes."""
    if not image_bytes or image_bytes == b"empty":
        return ""
    try:
        # 9x8 size provides 8x8 = 64 horizontal adjacent difference comparisons
        img = Image.open(io.BytesIO(image_bytes)).convert("L").resize(
            (9, 8), Image.Resampling.LANCZOS
        )
        arr = np.asarray(img, dtype=np.int16)
        # Compute horizontal gradients (pixels brighter than right neighbor)
        diff = arr[:, 1:] > arr[:, :-1]
        bits = "".join(["1" if b else "0" for b in diff.flatten()])
        return f"{int(bits, 2):016x}"
    except Exception:
        return ""


def hamming_distance(hash1: str, hash2: str) -> int:
    """Count the number of differing bits between two 16-character hex fingerprints."""
    if not hash1 or not hash2 or len(hash1) != 16 or len(hash2) != 16:
        return 64
    try:
        x = int(hash1, 16) ^ int(hash2, 16)
        return bin(x).count("1")
    except ValueError:
        return 64


def check_duplicate_lot(
    db: Session,
    image_bytes: bytes,
    threshold: int = 6,
    current_lot_id: str | None = None,
) -> dict:
    """Check if an uploaded image visually duplicates an existing recorded lot.

    Returns:
        {
            "fingerprint": str,
            "is_duplicate": bool,
            "duplicate_of_lot": str | None,
            "similarity_pct": float,
            "distance": int,
        }
    """
    from ..models import Lot

    fingerprint = compute_fingerprint(image_bytes)
    if not fingerprint:
        return {
            "fingerprint": "",
            "is_duplicate": False,
            "duplicate_of_lot": None,
            "similarity_pct": 0.0,
            "distance": 64,
        }

    candidates = []
    try:
        # Query lots that have a recorded image fingerprint
        q = db.query(Lot.lot_id, Lot.image_fingerprint).filter(
            Lot.image_fingerprint != "",
            Lot.image_fingerprint.isnot(None),
        )
        if current_lot_id:
            q = q.filter(Lot.lot_id != current_lot_id)
        candidates = q.order_by(Lot.id.desc()).limit(300).all()
    except Exception:
        db.rollback()
        candidates = []

    best_match_lot = None
    min_dist = 64

    for lot_id, existing_hash in candidates:
        dist = hamming_distance(fingerprint, existing_hash)
        if dist < min_dist:
            min_dist = dist
            best_match_lot = lot_id
            if dist == 0:
                break

    is_duplicate = min_dist <= threshold
    similarity_pct = round(max(0.0, (64 - min_dist) / 64.0 * 100), 1)

    return {
        "fingerprint": fingerprint,
        "is_duplicate": is_duplicate,
        "duplicate_of_lot": best_match_lot if is_duplicate else None,
        "similarity_pct": similarity_pct,
        "distance": min_dist,
    }
