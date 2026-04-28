import React, { useEffect, useRef, useCallback, useState } from "react";

/**
 * MapProvider — singleton AMap 2.0 instance with FOCUS_POI event listener.
 *
 * Design decisions:
 *   - Map instance lives in a module-level ref → never destroyed on re-render
 *   - AMap JS SDK loaded once via dynamic <script> with a global sentinel flag
 *   - FOCUS_POI CustomEvent bridges ItineraryCard onClick → map pan
 *   - API key read from import.meta.env.VITE_AMAP_API_KEY (never hard-coded)
 *   - Map panel hidden by default; auto-shows when a FOCUS_POI event arrives
 *
 * Usage:
 *   Wrap your app (or just the layout) with <MapProvider />.
 *   Call openPoi(poi) from anywhere — MapProvider picks up the CustomEvent.
 *
 *   <MapProvider>
 *     <App />
 *   </MapProvider>
 */

// ── Module-level singletons (survive component re-mounts) ──────────────────
let _mapInstance   = null;   // AMap.Map singleton
let _placeSearch   = null;   // AMap.PlaceSearch plugin singleton
let _scriptLoaded  = false;  // true once the SDK <script> has fired onload
let _scriptLoading = false;  // true while the <script> tag is being fetched
const _readyCallbacks = [];  // queued callbacks waiting for SDK load

const AMAP_KEY          = import.meta.env.VITE_AMAP_API_KEY      || "";
const AMAP_SECURITY_KEY = import.meta.env.VITE_AMAP_SECURITY_KEY || "";
const AMAP_VERSION = "2.0";
const AMAP_PLUGINS = "AMap.PlaceSearch,AMap.Scale,AMap.ToolBar";

// ── SDK loader (idempotent) ────────────────────────────────────────────────
function loadAmapSdk(onReady) {
  if (_scriptLoaded) { onReady?.(); return; }
  _readyCallbacks.push(onReady);
  if (_scriptLoading) return;

  if (!AMAP_KEY) {
    console.error("[MapProvider] VITE_AMAP_API_KEY is not set in .env.local");
    return;
  }

  // AMap 2.0 requires the security config to be set BEFORE the SDK script loads.
  // Without this, PlaceSearch and other paid plugins will be blocked in production.
  if (AMAP_SECURITY_KEY) {
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_KEY };
  } else {
    console.warn("[MapProvider] VITE_AMAP_SECURITY_KEY not set — PlaceSearch may fail on paid plans");
  }

  _scriptLoading = true;
  const script = document.createElement("script");
  script.src = `https://webapi.amap.com/maps?v=${AMAP_VERSION}&key=${AMAP_KEY}&plugin=${AMAP_PLUGINS}`;
  script.async = true;
  script.onload = () => {
    _scriptLoaded  = true;
    _scriptLoading = false;
    _readyCallbacks.splice(0).forEach((cb) => cb?.());
  };
  script.onerror = () => {
    _scriptLoading = false;
    console.error("[MapProvider] Failed to load AMap SDK. Check your API key and network.");
  };
  document.head.appendChild(script);
}

// ── MapProvider component ──────────────────────────────────────────────────
export default function MapProvider({ children }) {
  const containerRef = useRef(null);  // DOM node for the map canvas
  const [visible, setVisible] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  // ── Initialise map once SDK is loaded ────────────────────────────────────
  const initMap = useCallback(() => {
    if (_mapInstance || !containerRef.current || !window.AMap) return;

    _mapInstance = new window.AMap.Map(containerRef.current, {
      zoom:           13,
      center:         [116.397428, 39.90923],  // default: Beijing (overridden on first FOCUS_POI)
      mapStyle:       "amap://styles/dark",
      viewMode:       "2D",
      resizeEnable:   true,
    });

    // Scale + toolbar controls
    _mapInstance.addControl(new window.AMap.Scale());
    _mapInstance.addControl(new window.AMap.ToolBar({ position: "RB" }));

    // PlaceSearch for POI ID lookups
    window.AMap.plugin("AMap.PlaceSearch", () => {
      _placeSearch = new window.AMap.PlaceSearch({ map: _mapInstance });
    });

    setSdkReady(true);
    console.log("[MapProvider] AMap 2.0 initialised");
  }, []);

  // ── Load SDK on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    loadAmapSdk(() => {
      setSdkReady(true);
      initMap();
    });
  }, [initMap]);

  // Init map when sdk becomes ready (handles case where SDK was already loaded)
  useEffect(() => {
    if (sdkReady) initMap();
  }, [sdkReady, initMap]);

  // ── FOCUS_POI event listener ──────────────────────────────────────────────
  useEffect(() => {
    function handleFocusPoi(event) {
      const { name, amap_id, location, address } = event.detail || {};

      if (!_mapInstance) {
        console.warn("[MapProvider] Map not ready — SDK may still be loading");
        return;
      }

      setVisible(true);   // Show the map panel

      if (amap_id && _placeSearch) {
        // Most accurate: look up by Amap POI ID
        _placeSearch.getDetails(amap_id, (status, result) => {
          if (status === "complete" && result.poiList?.pois?.[0]) {
            const poi = result.poiList.pois[0];
            _mapInstance.setCenter(poi.location);
            _mapInstance.setZoom(16);
          } else {
            // PlaceSearch by ID failed — fall back to name search
            _focusByName(name || address);
          }
        });
      } else if (location) {
        // Direct coordinate pan
        const [lng, lat] = String(location).split(",").map(Number);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          _mapInstance.setCenter([lng, lat]);
          _mapInstance.setZoom(16);
          _addMarker([lng, lat], name);
        }
      } else if (name || address) {
        _focusByName(name || address);
      }
    }

    window.addEventListener("FOCUS_POI", handleFocusPoi);
    return () => window.removeEventListener("FOCUS_POI", handleFocusPoi);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {children}

      {/* Map panel — slides in from the bottom-right on desktop */}
      <div
        className="cx-map-panel"
        style={{
          display:    visible ? "flex" : "none",
          position:   "fixed",
          bottom:     80,
          right:      16,
          width:      "min(420px, calc(100vw - 32px))",
          height:     300,
          borderRadius: "var(--radius-lg)",
          overflow:   "hidden",
          boxShadow:  "0 8px 32px rgba(0,0,0,0.5)",
          zIndex:     200,
          flexDirection: "column",
        }}
      >
        {/* Close button */}
        <button
          onClick={() => setVisible(false)}
          style={{
            position:   "absolute",
            top:        8,
            right:      8,
            zIndex:     201,
            background: "rgba(0,0,0,0.6)",
            color:      "#fff",
            border:     "none",
            borderRadius: "50%",
            width:      28,
            height:     28,
            cursor:     "pointer",
            fontSize:   14,
            lineHeight: "28px",
            textAlign:  "center",
          }}
          aria-label="关闭地图"
        >
          ✕
        </button>

        {/* Map canvas — must remain in DOM once mounted so AMap can attach */}
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {!sdkReady && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--surface)", color: "var(--text-dim)", fontSize: 13,
          }}>
            地图加载中...
          </div>
        )}
      </div>
    </>
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _focusByName(keyword) {
  if (!keyword || !_mapInstance) return;
  if (_placeSearch) {
    _placeSearch.search(keyword, (status, result) => {
      if (status === "complete" && result.poiList?.pois?.[0]) {
        const poi = result.poiList.pois[0];
        _mapInstance.setCenter(poi.location);
        _mapInstance.setZoom(15);
      }
    });
  }
}

function _addMarker(position, title) {
  if (!_mapInstance || !window.AMap) return;
  const marker = new window.AMap.Marker({
    position,
    title: title || "",
  });
  _mapInstance.add(marker);
  // Auto-clear after 8s to avoid marker clutter
  setTimeout(() => _mapInstance.remove(marker), 8000);
}
