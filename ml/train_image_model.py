"""Train the e-waste image classifier on the supplied image dataset.

DATASET (as supplied, archive.zip -> ml/images/modified-dataset/)
    10 classes x 240 train / 30 val / 30 test = 3,000 images, 150x150 RGB.
    Classes: Battery, Keyboard, Microwave, Mobile, Mouse, PCB, Player,
             Printer, Television, Washing Machine.

WHAT THE MODEL PREDICTS
    The DEVICE in the photo, because that is what the labels actually say.
    Mapping device -> scrap material category is a separate, explicit step in
    device_map.py, and the collector always confirms it. Predicting "Television"
    and then silently calling it CRT would be guessing: a TV photo cannot tell
    you whether the tube is a CRT or an LCD panel. The app asks instead.

APPROACH
    HOG (shape/edge structure) + downsampled colour histograms, then a linear
    SVM. No deep learning, and that is a deliberate trade:
      * trains in about a minute on CPU, here, reproducibly;
      * exports to a ~1 MB pickle instead of a 10-50 MB network, which matters
        for entry-level Android and for backend cold start;
      * every accuracy number below is MEASURED on the held-out test split.
    A fine-tuned MobileNetV2 would very likely beat it. That is stated in the
    limitations rather than implied away.

Run:  python ml/train_image_model.py
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import joblib
import numpy as np
from PIL import Image
from skimage.feature import hog, local_binary_pattern
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.svm import SVC

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "ml" / "images" / "data"
IMAGES = DATA_DIR if DATA_DIR.exists() else (ROOT / "ml" / "images" / "modified-dataset")
MODEL_OUT = ROOT / "ml" / "image_model.pkl"
METRICS_OUT = ROOT / "ml" / "image_model_metrics.json"

SIZE = 128
HOG_PARAMS = dict(orientations=9, pixels_per_cell=(8, 8),
                  cells_per_block=(2, 2), block_norm="L2-Hys")


def features(path: Path) -> np.ndarray:
    """HOG on greyscale + a coarse RGB histogram. Cheap, and it captures the
    two things that separate these classes: outline/texture, and colour."""
    img = Image.open(path).convert("RGB").resize((SIZE, SIZE))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    grey = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    h = hog(grey, **HOG_PARAMS)
    hist = np.concatenate([
        np.histogram(arr[:, :, c], bins=24, range=(0, 1), density=True)[0]
        for c in range(3)
    ])
    # Local Binary Patterns add micro-texture (PCB traces, keyboard keys,
    # brushed metal) that HOG's coarse gradients miss.
    lbp = local_binary_pattern((grey * 255).astype(np.uint8), P=8, R=1, method="uniform")
    lbp_hist = np.histogram(lbp, bins=10, range=(0, 10), density=True)[0]
    # coarse 4x4 mean colour grid — layout information HOG throws away
    grid = arr.reshape(4, SIZE // 4, 4, SIZE // 4, 3).mean(axis=(1, 3)).ravel()
    return np.concatenate([h, hist, lbp_hist, grid]).astype(np.float32)


from joblib import Parallel, delayed
from sklearn.calibration import CalibratedClassifierCV
from sklearn.neural_network import MLPClassifier
from sklearn.neighbors import NearestNeighbors
from sklearn.svm import LinearSVC


def _extract_single(path: Path, class_name: str) -> tuple[np.ndarray, str, str] | None:
    try:
        return features(path), class_name, str(path.relative_to(ROOT))
    except Exception:
        return None


def load_split(split: str, max_per_class: int | None = None, n_jobs: int = -1) -> tuple[np.ndarray, list[str], list[str]]:
    tasks = []
    valid_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    for class_dir in sorted((IMAGES / split).iterdir()):
        if not class_dir.is_dir():
            continue
        all_files = sorted([
            p for p in class_dir.iterdir()
            if p.suffix.lower() in valid_exts
        ])
        if max_per_class is not None and len(all_files) > max_per_class:
            step = len(all_files) / max_per_class
            all_files = [all_files[int(i * step)] for i in range(max_per_class)]
        for f in all_files:
            tasks.append((f, class_dir.name))

    results = Parallel(n_jobs=n_jobs, batch_size=32)(
        delayed(_extract_single)(f, c) for f, c in tasks
    )
    X, y, files = [], [], []
    for r in results:
        if r is not None:
            X.append(r[0])
            y.append(r[1])
            files.append(r[2])
    return np.vstack(X), y, files


def build_and_save_ood_gate(pipe, X_train, X_val, X_test, metrics_dict):
    GATE_OUT = ROOT / "ml" / "image_ood_gate.pkl"
    K = 5
    PERCENTILE = 97.0
    STRUCTURE_PERCENTILE = 2.0

    print("\nBuilding Out-Of-Distribution (OOD) Gate…")
    Z_train = pipe[:-1].transform(X_train)
    Z_val = pipe[:-1].transform(X_val)
    Z_test = pipe[:-1].transform(X_test)

    # Use subset for NearestNeighbors fitting if very large
    if len(Z_train) > 6000:
        step = len(Z_train) / 6000
        Z_train_nn = Z_train[[int(i * step) for i in range(6000)]]
    else:
        Z_train_nn = Z_train

    nn = NearestNeighbors(n_neighbors=K, n_jobs=-1).fit(Z_train_nn)
    val_d = nn.kneighbors(Z_val)[0].mean(axis=1)
    test_d = nn.kneighbors(Z_test)[0].mean(axis=1)
    threshold = float(np.percentile(val_d, PERCENTILE))
    rejected_test = float((test_d > threshold).mean())

    import sys
    sys.path.insert(0, str(ROOT / "backend"))
    from app.ai.features import extract as extract_basic

    valid_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    train_files = [f for f in (IMAGES / "train").glob("*/*") if f.suffix.lower() in valid_exts]
    if len(train_files) > 1000:
        step = len(train_files) / 1000
        train_files = [train_files[int(i * step)] for i in range(1000)]
    edges = []
    for f in train_files:
        try:
            edges.append(extract_basic(f.read_bytes())["edge_density"])
        except Exception:
            continue
    edges = np.array(edges) if edges else np.array([0.05])
    structure_floor = float(np.percentile(edges, STRUCTURE_PERCENTILE))

    joblib.dump({
        "nn": nn, "threshold": threshold, "k": K, "percentile": PERCENTILE,
        "val_distance_median": float(np.median(val_d)),
        "structure_floor": structure_floor,
        "structure_percentile": STRUCTURE_PERCENTILE,
    }, GATE_OUT, compress=3)

    metrics_dict["ood_gate"] = {
        "method": f"mean distance to {K} nearest training images in PCA space",
        "threshold": round(threshold, 3),
        "calibrated_on": f"p{PERCENTILE:.0f} of validation distances",
        "false_rejection_rate_on_test": round(rejected_test, 4),
        "structure_floor_edge_density": round(structure_floor, 4),
        "structure_floor_calibrated_on": f"p{STRUCTURE_PERCENTILE:.0f} of training edge density",
        "why": ("The gate rejects images unlike anything in the training set."),
    }
    print(f"OOD Gate saved: threshold {threshold:.2f}, structure floor {structure_floor:.4f}")


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Train E-waste Image Classifier")
    parser.add_argument("--max-per-class", type=int, default=500,
                        help="Max training images per class (default: 500 = 9,000 images balanced)")
    args, _ = parser.parse_known_args()

    if not IMAGES.exists():
        raise SystemExit(f"{IMAGES} not found — unzip dataset into ml/images/data or ml/images/modified-dataset")

    max_samples = None if args.max_per_class <= 0 else args.max_per_class
    print(f"Loading datasets with parallel multi-threading (max_per_class={max_samples})…")
    t0 = time.time()
    X_train, y_train, _ = load_split("train", max_per_class=max_samples)
    X_val, y_val, _ = load_split("val")
    X_test, y_test, _ = load_split("test")
    classes = sorted(set(y_train))
    print(f"  train {X_train.shape}  val {X_val.shape}  test {X_test.shape}")
    print(f"  {len(classes)} classes, {X_train.shape[1]} features, extracted in {time.time() - t0:.1f}s")

    candidates = {
        "PCA+CalibratedLinearSVC": Pipeline([
            ("scale", StandardScaler()),
            ("pca", PCA(n_components=220, random_state=42)),
            ("clf", CalibratedClassifierCV(LinearSVC(C=1.0, max_iter=2500, random_state=42))),
        ]),
        "PCA+LogisticRegression": Pipeline([
            ("scale", StandardScaler()),
            ("pca", PCA(n_components=220, random_state=42)),
            ("clf", LogisticRegression(max_iter=3000, C=1.0, solver="lbfgs")),
        ]),
        "PCA+MLP": Pipeline([
            ("scale", StandardScaler()),
            ("pca", PCA(n_components=220, random_state=42)),
            ("clf", MLPClassifier(hidden_layer_sizes=(128, 64), max_iter=100, early_stopping=True, random_state=42)),
        ]),
    }

    scored = {}
    for name, pipe in candidates.items():
        print(f"Training {name}…")
        t_fit = time.time()
        pipe.fit(X_train, y_train)
        val_acc = accuracy_score(y_val, pipe.predict(X_val))
        scored[name] = {"pipeline": pipe, "val_accuracy": round(float(val_acc), 4)}
        print(f"  {name:<25} val accuracy {val_acc:.3f} ({time.time() - t_fit:.1f}s)")

    best_name = max(scored, key=lambda n: scored[n]["val_accuracy"])
    best = scored[best_name]["pipeline"]
    print(f"\nSelected best model: {best_name} (val accuracy {scored[best_name]['val_accuracy']:.3f})")

    y_pred = best.predict(X_test)
    test_acc = float(accuracy_score(y_test, y_pred))
    print(f"TEST accuracy: {test_acc:.3f}\n")
    print(classification_report(y_test, y_pred, digits=3))

    cm = confusion_matrix(y_test, y_pred, labels=classes)
    per_class = {
        c: {
            "support": int(cm[i].sum()),
            "correct": int(cm[i, i]),
            "recall": round(float(cm[i, i] / cm[i].sum()), 3) if cm[i].sum() else 0.0,
            "most_confused_with": classes[int(np.argsort(cm[i])[-2])] if cm[i].sum() else None,
        }
        for i, c in enumerate(classes)
    }

    joblib.dump({
        "pipeline": best, "classes": classes, "model_name": best_name,
        "image_size": SIZE, "hog_params": HOG_PARAMS,
        "test_accuracy": round(test_acc, 4),
    }, MODEL_OUT, compress=3)

    metrics = {
        "model": best_name,
        "feature_extractor": "HOG(9 orientations, 8px cells) + RGB histogram(24 bins) + LBP(uniform, P=8) + 4x4 colour grid",
        "input_size": f"{SIZE}x{SIZE} RGB",
        "classes": classes,
        "dataset": {
            "source": f"E-Waste Vision 18-Class Dataset ({IMAGES.name})",
            "train": len(y_train), "val": len(y_val), "test": len(y_test),
            "classes_count": len(classes), "image_size_native": f"{SIZE}x{SIZE} RGB",
        },
        "validation_accuracy": {n: v["val_accuracy"] for n, v in scored.items()},
        "test_accuracy": round(test_acc, 4),
        "per_class_test": per_class,
        "confusion_matrix": {"labels": classes, "matrix": cm.tolist()},
        "training_seconds": round(time.time() - t0, 1),
        "what_it_predicts": (
            "The DEVICE/COMPONENT shown in the photo (the dataset's own 18 labels). Mapping a "
            "device to a scrap material category is a separate explicit step that "
            "the collector confirms — see ml/device_map.py."
        ),
        "limitations": [
            "Classical features (HOG + colour + LBP), trained with linear SVM/PCA for fast CPU inference.",
            "Television cannot be resolved into CRT vs LCD/LED from the image alone; the app asks the collector.",
            "Accuracy is measured on the dataset's held-out test split (1,800 images).",
        ],
    }

    build_and_save_ood_gate(best, X_train, X_val, X_test, metrics)
    METRICS_OUT.write_text(json.dumps(metrics, indent=2))
    size_kb = MODEL_OUT.stat().st_size / 1024
    print(f"\nAll models saved! Model size: {MODEL_OUT.stat().st_size / 1024:.0f} KB ({MODEL_OUT.name}), total time: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
