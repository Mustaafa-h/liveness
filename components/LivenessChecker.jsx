"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { earFromLandmarks, yawProxy, ema } from "../lib/geometry";

/**
 * LivenessChecker.jsx (UMD build loader + DEBUG + race-proof pass)
 * - Loads MediaPipe FaceMesh & Camera Utils via UMD <script> tags.
 * - Uses window.FaceMesh and window.Camera (avoids constructor import issues).
 * - Blink hysteresis + refractory, frame-local pass check, final guard.
 */

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[Liveness]", ...a);
const warn = (...a) => DEBUG && console.warn("[Liveness]", ...a);
const err = (...a) => DEBUG && console.error("[Liveness]", ...a);

// UMD bundles
const FACE_MESH_UMD = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js";
const CAMERA_UTILS_UMD = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";

// load <script> once
const scriptCache = new Map();
function loadScriptOnce(src, timeoutMs = 15000) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    log("Loading script:", src);
    const el = document.createElement("script");
    el.async = true;
    el.src = src;
    const timer = setTimeout(() => {
      el.remove();
      reject(new Error(`Timeout loading ${src}`));
    }, timeoutMs);
    el.onload = () => { clearTimeout(timer); log("Loaded:", src); resolve(); };
    el.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load ${src}`)); };
    document.head.appendChild(el);
  });
  scriptCache.set(src, p);
  return p;
}

export default function LivenessChecker({
  sessionWindowMs = 8000,
  earThreshold = 0.18,      // close threshold
  earCloseMinMs = 120,
  yawAbsThreshold = 0.55,
  yawHoldMinMs = 250,
  onChange,
}) {
  // DOM
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Instances
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);

  // UI state
  const [isRunning, setIsRunning] = useState(false);
  const [permissionError, setPermissionError] = useState(null);
  const [blinkCount, setBlinkCount] = useState(0);
  const [turnDetected, setTurnDetected] = useState(null); // "left" | "right" | null
  const [livenessPassed, setLivenessPassed] = useState(false);

  // debug metrics
  const [leftEAR, setLeftEAR] = useState(0);
  const [rightEAR, setRightEAR] = useState(0);
  const [yawDev, setYawDev] = useState(0);

  const [turnedLeft, setTurnedLeft] = useState(false);
  const [turnedRight, setTurnedRight] = useState(false);

  // internals
  const startedAtRef = useRef(null);
  const earLeftEMARef = useRef(null);
  const earRightEMARef = useRef(null);
  const eyesClosedSinceRef = useRef(null);
  const eyesWereClosedRef = useRef(false);
  const lastBlinkAtRef = useRef(0);

  const yawEMARef = useRef(null);
  const yawBeyondSinceRef = useRef(null);

  const frameCountRef = useRef(0);
  const lastFacePresentRef = useRef(false);

  const blinkCountRef = useRef(0);


  const resetSession = useCallback(() => {
    log("Reset session");
    setBlinkCount(0);
    blinkCountRef.current = 0;
    setTurnDetected(null);
    setTurnedLeft(false);
    setTurnedRight(false);
    setLivenessPassed(false);
    setPermissionError(null);

    setLeftEAR(0);
    setRightEAR(0);
    setYawDev(0);

    earLeftEMARef.current = null;
    earRightEMARef.current = null;
    eyesClosedSinceRef.current = null;
    eyesWereClosedRef.current = false;
    lastBlinkAtRef.current = 0;

    yawEMARef.current = null;
    yawBeyondSinceRef.current = null;

    startedAtRef.current = Date.now();
    frameCountRef.current = 0;
    lastFacePresentRef.current = false;
  }, []);

  const start = useCallback(async () => {
    log("Start clicked");
    resetSession();
    setIsRunning(true);

    try {
      if (!videoRef.current || !canvasRef.current) {
        throw new Error("Video/Canvas refs not ready");
      }

      await loadScriptOnce(FACE_MESH_UMD);
      await loadScriptOnce(CAMERA_UTILS_UMD);

      const FaceMeshGlobal = window.FaceMesh;
      const CameraGlobal = window.Camera;
      if (!FaceMeshGlobal) throw new Error("window.FaceMesh not found after loading UMD");
      if (!CameraGlobal) throw new Error("window.Camera not found after loading UMD");
      log("UMD globals present");

      const fm = new FaceMeshGlobal({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      fm.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      fm.onResults(onResults);
      faceMeshRef.current = fm;
      log("FaceMesh ready");

      const cam = new CameraGlobal(videoRef.current, {
        onFrame: async () => {
          try { await fm.send({ image: videoRef.current }); }
          catch (e) { err("fm.send failed:", e?.name || e, e?.message || ""); }
        },
        width: 640, height: 480,
      });
      cameraRef.current = cam;

      log("Starting camera…");
      await cam.start(); // permission prompt
      log("Camera started");
    } catch (e) {
      const name = e?.name ?? "Error";
      const message = e?.message ?? "Unknown error";
      let hint = "";
      if (name === "NotAllowedError") hint = " (permission blocked)";
      else if (name === "NotFoundError") hint = " (no camera device)";
      else if (name === "NotReadableError") hint = " (camera busy by another app)";
      else if (name === "OverconstrainedError") hint = " (choose another default camera in chrome://settings/content/camera)";
      err("Start error:", name, message);
      setPermissionError(`${name}: ${message}${hint}`);
      setIsRunning(false);
    }
  }, [resetSession]);

  const stop = useCallback(() => {
    log("Stop requested");
    setIsRunning(false);
    try { cameraRef.current?.stop(); log("Camera stopped"); } catch (e) { warn("camera.stop error:", e); }
    cameraRef.current = null;
    try { faceMeshRef.current?.close(); log("FaceMesh closed"); } catch (e) { warn("faceMesh.close error:", e); }
    faceMeshRef.current = null;
  }, []);

  const handleReset = useCallback(async () => {
    log("Hard reset");
    stop();
    await new Promise((r) => setTimeout(r, 80));
    start();
  }, [start, stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  // 🔁 Always push FRESH values to parent
  useEffect(() => {
    if (typeof onChange === "function") {
      onChange({
        livenessPassed,
        blinkCount,
        turnDetected,
        turnedLeft,
        turnedRight,
        leftEAR,
        rightEAR,
        yawDev,
        sessionStartedAt: startedAtRef.current,
      });
    }
  }, [livenessPassed, blinkCount, turnDetected, leftEAR, rightEAR, yawDev, onChange]);

  // ✅ Final guard: if both conditions satisfied at any point, flip to true
  useEffect(() => {
    if (!livenessPassed && turnedLeft && turnedRight && blinkCount >= 2) {
      console.log("[Liveness] Final guard → pass (both turns + 2 blinks)");
      setLivenessPassed(true);
    }
  }, [turnedLeft, turnedRight, blinkCount, livenessPassed]);


  useEffect(() => {
    blinkCountRef.current = blinkCount;
  }, [blinkCount]);


  const onResults = useCallback((results) => {
    frameCountRef.current += 1;

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.width = results.image.width;
      canvas.height = results.image.height;

      // draw camera frame
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      const lm = results.multiFaceLandmarks?.[0];
      const facePresent = !!lm;

      if (facePresent && !lastFacePresentRef.current) log("Face FOUND");
      if (!facePresent && lastFacePresentRef.current) log("Face LOST");
      lastFacePresentRef.current = facePresent;

      if (!lm) {
        eyesClosedSinceRef.current = null;
        yawBeyondSinceRef.current = null;
        updateDebug(0, 0, 0);
        return;
      }

      // ---------- EAR (blink) with EMA + hysteresis + refractory ----------
      const left = earFromLandmarks(lm, 159, 145, 33, 133);
      const right = earFromLandmarks(lm, 386, 374, 263, 362);
      earLeftEMARef.current = ema(earLeftEMARef.current, left, 0.35);
      earRightEMARef.current = ema(earRightEMARef.current, right, 0.35);

      const lSm = earLeftEMARef.current ?? left;
      const rSm = earRightEMARef.current ?? right;
      const earAvg = (lSm + rSm) / 2;

      // hysteresis: need to rise above openTh to leave "closed"
      const closeTh = earThreshold;        // enter closed below this
      const openTh = earThreshold + 0.03; // leave closed above this
      const now = performance.now();

      const eyesClosed = eyesWereClosedRef.current
        ? (earAvg < openTh)   // once closed, stay closed until we go above openTh
        : (earAvg < closeTh); // to enter closed, must go below closeTh

      // We'll compute "next" values locally to avoid races
      let nextBlinkCount = blinkCount;
      let nextTurnDetected = turnDetected;

      if (eyesClosed) {
        if (!eyesWereClosedRef.current) {
          eyesWereClosedRef.current = true;
          eyesClosedSinceRef.current = now;
        }
      } else if (eyesWereClosedRef.current) {
        // just transitioned closed -> open
        const closedMs = now - (eyesClosedSinceRef.current ?? now);
        eyesWereClosedRef.current = false;
        eyesClosedSinceRef.current = null;

        if (closedMs >= earCloseMinMs) {
          const refractoryMs = 250;
          if (now - lastBlinkAtRef.current >= refractoryMs) {
            const newCount = blinkCountRef.current + 1; // ← read the live value
            setBlinkCount(newCount);
            blinkCountRef.current = newCount;          // ← keep ref hot
            nextBlinkCount = newCount;                 // ← so frame-local pass check uses 2+
            lastBlinkAtRef.current = now;
            log(`Blink detected (closed ~${Math.round(closedMs)}ms). Total: ${newCount}`);
          } else {
            log("Blink ignored (refractory)", Math.round(now - lastBlinkAtRef.current), "ms");
          }
        }
      }

      // ---------- Yaw (turn) with EMA + hold ----------
      const yawRaw = yawProxy(lm);              // cheek-normalized nose offset recommended
      yawEMARef.current = ema(yawEMARef.current, yawRaw, 0.25);
      const yawSm = yawEMARef.current ?? yawRaw;

      const beyond = Math.abs(yawSm) >= yawAbsThreshold;
      if (frameCountRef.current % 10 === 0) {
        const heldNow = yawBeyondSinceRef.current ? Math.round(now - yawBeyondSinceRef.current) : 0;
        log(`yawSm=${yawSm.toFixed(3)} beyond=${beyond} holdMs=${heldNow} turnDetected=${turnDetected}`);
      }

      if (beyond) {
        if (!yawBeyondSinceRef.current) {
          yawBeyondSinceRef.current = now;
        } else {
          const held = now - yawBeyondSinceRef.current;
          if (held >= yawHoldMinMs) {
            const dir = yawSm > 0 ? "right" : "left";
            // remember last direction for UI
            if (!turnDetected) setTurnDetected(dir);

            // set flags (both can eventually become true across frames)
            if (dir === "left") setTurnedLeft(true);
            if (dir === "right") setTurnedRight(true);

            // for race-proof frame check, compute local next values
            const nextLeft = dir === "left" ? true : turnedLeft;
            const nextRight = dir === "right" ? true : turnedRight;

            log(`Head turn: ${dir} (|yaw|≈${Math.abs(yawSm).toFixed(2)}, held ~${Math.round(held)}ms)`);

            // frame-local pass check (both directions achieved)
            if (!livenessPassed && nextLeft && nextRight && nextBlinkCount >= 2) {
              log("Frame check → pass (both turns + 2 blinks)");
              setLivenessPassed(true);
            }
          }

        }
      } else {
        yawBeyondSinceRef.current = null;
      }

      // overlay + metrics
      drawOverlay(ctx, lm);
      if (frameCountRef.current % 30 === 0) {
        log(`EAR(L/R): ${lSm.toFixed(3)}/${rSm.toFixed(3)}  yaw: ${yawSm.toFixed(3)}`);
      }
      updateDebug(lSm, rSm, yawSm);

      // ---------- frame-local decisive check (race-proof) ----------
      if (!livenessPassed && nextBlinkCount >= 2 && !!nextTurnDetected) {
        log("Frame check → livenessPassed = true");
        setLivenessPassed(true);
      }
    } catch (e) {
      err("onResults error:", e?.name || e, e?.message || "");
    }
    // include changing deps referenced in the function
  }, [blinkCount, turnDetected, livenessPassed, earThreshold, earCloseMinMs, yawAbsThreshold, yawHoldMinMs]);

  function drawOverlay(ctx, lm) {
    const pts = [1, 33, 133, 159, 145, 263, 362, 386, 374, 234, 454];
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(96,165,250,0.7)";
    ctx.fillStyle = "rgba(16,185,129,0.9)";
    for (const i of pts) {
      const p = lm[i]; if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const pairs = [[159, 145], [386, 374], [33, 133], [263, 362], [234, 454]];
    ctx.strokeStyle = "rgba(148,163,184,0.7)";
    for (const [a, b] of pairs) {
      const p = lm[a], q = lm[b]; if (!p || !q) continue;
      ctx.beginPath();
      ctx.moveTo(p.x * ctx.canvas.width, p.y * ctx.canvas.height);
      ctx.lineTo(q.x * ctx.canvas.width, q.y * ctx.canvas.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function updateDebug(lEAR, rEAR, yaw) {
    setLeftEAR(Number(lEAR.toFixed(3)));
    setRightEAR(Number(rEAR.toFixed(3)));
    setYawDev(Number(yaw.toFixed(3)));
  }

  // ✅ Correct, simple, state-based check (kept for readability)
  function checkComplete() {
    const ok = turnedLeft && turnedRight;
    if (ok && !livenessPassed) {
      log("checkComplete → livenessPassed = true");
      setLivenessPassed(true);
    }
  }

  function checkWindow() {
    if (!startedAtRef.current) return;
    // informational only; you can auto-fail after sessionWindowMs if needed
  }

  // Buttons
  const startBtn = (
    <button onClick={start} style={btnStyle} disabled={isRunning} title="Start camera and detection">
      Start
    </button>
  );
  const resetBtn = (
    <button onClick={handleReset} style={btnStyle} title="Reset session">
      Reset
    </button>
  );
  const stopBtn = (
    <button onClick={stop} style={btnStyle} title="Stop camera">
      Stop
    </button>
  );

  const statusColor = permissionError
    ? "#ef4444"
    : livenessPassed
      ? "#10b981"
      : "#f59e0b";

  const elapsedSec = startedAtRef.current
    ? ((Date.now() - startedAtRef.current) / 1000).toFixed(1)
    : "0.0";

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>
          Face Liveness Demo (Blink + Head Turn)
        </div>
        <div style={{ ...badgeStyle, borderColor: statusColor, color: statusColor }}>
          {permissionError ? "Permission error" : livenessPassed ? "Liveness Passed" : "Awaiting Actions"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {!isRunning ? startBtn : (<>{resetBtn}{stopBtn}</>)}
      </div>

      {permissionError && (
        <div style={{ color: "#ef4444", marginBottom: 8 }}>
          {permissionError}
        </div>
      )}

      <div style={gridStyle}>
        <div style={cardStyle}>
          <div style={mediaStyle}>
            <video ref={videoRef} muted playsInline style={{ display: "none" }} />
            <canvas ref={canvasRef} />
          </div>
          <div style={{ marginTop: 8, color: "#9ca3af", fontSize: 14 }}>
            • If the preview is mirrored, that’s normal for front cameras. Blink once, then turn your head.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={kvStyle}>
            <div style={kvLabel}>livenessPassed</div>
            <div style={{ ...kvValue, color: livenessPassed ? "#10b981" : "#9ca3af" }}>{String(livenessPassed)}</div>

            <div style={kvLabel}>blinkCount</div>
            <div style={kvValue}>{blinkCount}</div>

            <div style={kvLabel}>turnedLeft / turnedRight</div>
            <div style={kvValue}>{String(turnedLeft)} / {String(turnedRight)}</div>


            <div style={kvLabel}>leftEAR / rightEAR</div>
            <div style={kvValue}>{leftEAR} / {rightEAR}</div>

            <div style={kvLabel}>yawProxy (±)</div>
            <div style={kvValue}>{yawDev}</div>

            <div style={kvLabel}>sessionWindow</div>
            <div style={kvValue}>{(sessionWindowMs / 1000).toFixed(0)}s</div>

            <div style={kvLabel}>elapsed</div>
            <div style={kvValue}>{elapsedSec}s</div>

            <div style={kvLabel}>thresholds</div>
            <div style={{ ...kvValue, color: "#9ca3af" }}>
              EAR&lt;{earThreshold} → closed; |yaw|≥{yawAbsThreshold} for {yawHoldMinMs}ms
            </div>
          </div>
          <div style={{ height: 1, background: "#1f2937", margin: "8px 0" }} />
          <div style={{ color: "#9ca3af", fontSize: 14 }}>
            If blinks are missed, lower EAR threshold (e.g., 0.16). If turns don’t trigger, lower yaw (e.g., 0.45) or hold (e.g., 220ms).
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8, color: "#9ca3af", fontSize: 14 }}>
        Privacy: all processing is local; no frames leave your browser.
      </div>
    </div>
  );
}

/* ===== styles ===== */
const panelStyle = {
  background: "linear-gradient(180deg,#0b1220,#111827)",
  border: "1px solid #1f2937",
  borderRadius: 16,
  padding: 12,
  color: "#e5e7eb",
};
const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 8,
  flexWrap: "wrap",
};
const badgeStyle = {
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid #334155",
  fontSize: 14,
};
const btnStyle = {
  background: "#111827",
  color: "#e5e7eb",
  border: "1px solid #1f2937",
  padding: "8px 12px",
  borderRadius: 10,
  cursor: "pointer",
};
const gridStyle = {
  display: "grid",
  gridTemplateColumns: "1.4fr 1fr",
  gap: 12,
};
const cardStyle = {
  background: "#0b1220",
  border: "1px solid #1f2937",
  borderRadius: 12,
  padding: 8,
};
const mediaStyle = {
  position: "relative",
  width: "100%",
  aspectRatio: "4 / 3",
  background: "#0a0f1a",
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid #1f2937",
};
const kvStyle = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "8px 12px",
  fontSize: 15,
  padding: 6,
};
const kvLabel = { color: "#9ca3af" };
const kvValue = { fontVariantNumeric: "tabular-nums" };
