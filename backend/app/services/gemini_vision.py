import base64
import json
import logging
from pathlib import Path
import urllib.request
import urllib.error

from ..config import settings

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"


def _extract_image_data(img_input: str | bytes) -> tuple[str, str] | tuple[None, None]:
    """Extract (mime_type, base64_str) from data URL, file path, or raw bytes."""
    if not img_input:
        return None, None

    if isinstance(img_input, bytes):
        return "image/jpeg", base64.b64encode(img_input).decode("utf-8")

    if isinstance(img_input, str):
        # Check if it's a data URL
        if img_input.startswith("data:") and "," in img_input:
            header, b64_part = img_input.split(",", 1)
            mime = header.split(";")[0].replace("data:", "").strip() or "image/jpeg"
            return mime, b64_part.strip()

        # Check if it's a local file path
        p = Path(img_input)
        if p.exists() and p.is_file():
            raw = p.read_bytes()
            suffix = p.suffix.lower().lstrip(".")
            mime = f"image/{suffix}" if suffix in ("jpeg", "jpg", "png", "webp") else "image/jpeg"
            return mime, base64.b64encode(raw).decode("utf-8")

        # Assume raw base64 string
        if len(img_input) > 100:
            return "image/jpeg", img_input.strip()

    return None, None


def compare_handover_images(
    collector_photo: str,
    recycler_photo: str,
    material_category: str = "E-waste",
) -> dict:
    """Compare collector's lot photo vs recycler's handover photo using Gemini Vision.

    Detects fraudulent material substitution or visual discrepancies while accounting
    for different viewing angles, lighting, background, and distance.
    """
    mime_col, b64_col = _extract_image_data(collector_photo)
    mime_rec, b64_rec = _extract_image_data(recycler_photo)

    if not b64_col or not b64_rec:
        return {
            "is_match": True,
            "anomaly_detected": False,
            "confidence": 0.0,
            "reason": "One or both photos unavailable for visual comparison.",
            "collector_item": material_category,
            "recycler_item": material_category,
            "audited_by": "skipped",
        }

    api_key = settings.GEMINI_API_KEY
    if not api_key:
        logger.warning("No GEMINI_API_KEY configured.")
        return {
            "is_match": True,
            "anomaly_detected": False,
            "confidence": 0.0,
            "reason": "Gemini API key not configured.",
            "audited_by": "skipped",
        }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"

    prompt = (
        f"You are an expert e-waste visual verification AI auditing a scrap transaction.\n"
        f"- Image 1: Uploaded by the scrap collector when creating the lot (declared category: '{material_category}').\n"
        f"- Image 2: Uploaded by the authorised recycler during physical handover/weighing on the scales.\n\n"
        f"CRITICAL INSTRUCTIONS:\n"
        f"1. Natural variations in camera angle, rotation, perspective, lighting, zoom, and background (e.g. on a weighing scale vs floor) are EXPECTED and NORMAL.\n"
        f"2. If Image 2 shows the SAME physical scrap item/device or genuine material matching Image 1, mark as MATCH (is_match: true, anomaly_detected: false).\n"
        f"3. If Image 2 shows a COMPLETELY DIFFERENT item, a different electronic appliance/component, or a clear fraudulent substitution (e.g. collector declared battery/motherboard, but recycler received a motor, casing, or non-matching item), mark as ANOMALY (is_match: false, anomaly_detected: true).\n\n"
        f"Return strict JSON with this schema:\n"
        f'{{\n'
        f'  "is_match": boolean,\n'
        f'  "anomaly_detected": boolean,\n'
        f'  "confidence": float (0.0 to 1.0),\n'
        f'  "reason": string (clear, concise explanation of comparison),\n'
        f'  "collector_item": string (brief description of item in Image 1),\n'
        f'  "recycler_item": string (brief description of item in Image 2)\n'
        f'}}'
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"inlineData": {"mimeType": mime_col, "data": b64_col}},
                    {"inlineData": {"mimeType": mime_rec, "data": b64_rec}},
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content_text = data["candidates"][0]["content"]["parts"][0]["text"]
            result = json.loads(content_text)
            result["audited_by"] = f"gemini-vision ({GEMINI_MODEL})"
            return result
    except Exception as exc:
        logger.error(f"Gemini vision audit failed: {exc}")
        return {
            "is_match": True,
            "anomaly_detected": False,
            "confidence": 0.0,
            "reason": f"Gemini audit fallback: {str(exc)}",
            "audited_by": "fallback",
        }
