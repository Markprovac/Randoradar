/* Rando Radar v1.10.26 — marqueur altitude aligné + fiche parcours glissable */
(() => {
  'use strict';

  const ROUTER_MIN_INTERVAL = 1100;
  const SAVED_ROUTES_KEY = 'randoRadar.savedRoutes.v1';
  const ACTIVE_ACTIVITY_KEY = 'randoRadar.activeActivity.v1';
  const RADAR_PREF_KEY = 'randoRadar.radarPrefs.v1';
  let lastActivityPersistAt = 0;
  let activityPersistWarned = false;
  const VALHALLA_ROUTE_URL = 'https://valhalla1.openstreetmap.de/route';
  const OVERPASS_ENDPOINTS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
  ];
  const WAYMARKED_HIKING_API = 'https://hiking.waymarkedtrails.org/api/v1';
  const FINDER_PROFILES = {
    hike:   { label: 'Randonnée', icon: '🥾', relationRoutes: ['hiking','foot'], transportMode: 'hike' },
    road:   { label: 'Vélo route', icon: '🚴', relationRoutes: ['bicycle'], transportMode: 'bike' },
    gravel: { label: 'Gravel', icon: '🚲', relationRoutes: ['bicycle'], transportMode: 'bike' },
    mtb:    { label: 'VTT', icon: '🚵', relationRoutes: ['mtb','bicycle'], transportMode: 'bike' }
  };
  const ACTIVITY_PROFILES = {
    hike:   { label: 'Randonnée', icon: '🥾', cycling: false, navSpeed: 4,  maxPlausible: 35,  nativeAccuracy: 30, nativeMaxSpeed: 160, offRouteM: 80 },
    road:   { label: 'Vélo route', icon: '🚴', cycling: true,  navSpeed: 20, maxPlausible: 120, nativeAccuracy: 40, nativeMaxSpeed: 160, offRouteM: 120 },
    gravel: { label: 'Gravel',     icon: '🚲', cycling: true,  navSpeed: 17, maxPlausible: 120, nativeAccuracy: 40, nativeMaxSpeed: 160, offRouteM: 110 },
    mtb:    { label: 'VTT',        icon: '🚵', cycling: true,  navSpeed: 12, maxPlausible: 120, nativeAccuracy: 40, nativeMaxSpeed: 160, offRouteM: 100 }
  };
  const PLANNER_PROFILES = {
    hike: {
      label: 'Randonnée', short: 'Rando', icon: '🥾', activityMode: 'hike',
      costing: 'pedestrian', costingOptions: {},
      description: 'sentiers et chemins pédestres privilégiés'
    },
    road: {
      label: 'Vélo route', short: 'Route', icon: '🚴', activityMode: 'road',
      costing: 'bicycle',
      costingOptions: { bicycle: { bicycle_type: 'Road', use_roads: 1.0, use_hills: 0.5, avoid_bad_surfaces: 1.0 } },
      description: 'routes et surfaces adaptées au vélo de route privilégiées'
    },
    gravel: {
      label: 'Gravel', short: 'Gravel', icon: '🚲', activityMode: 'gravel',
      costing: 'bicycle',
      costingOptions: { bicycle: { bicycle_type: 'Cross', use_roads: 0.5, use_hills: 0.5, avoid_bad_surfaces: 0.35 } },
      description: 'routes, voies cyclables et pistes roulantes acceptées'
    },
    mtb: {
      label: 'VTT', short: 'VTT', icon: '🚵', activityMode: 'mtb',
      costing: 'bicycle',
      costingOptions: { bicycle: { bicycle_type: 'Mountain', use_roads: 0.15, use_hills: 0.65, avoid_bad_surfaces: 0.05 } },
      description: 'chemins et pistes tout-terrain davantage favorisés'
    }
  };

  const state = {
    map: null,
    mapFullscreen: false,
    baseLayers: {},
    activeBase: 'topo',
    radarFrames: [],
    radarHost: '',
    radarLayer: null,
    radarEnabled: true,
    radarTimer: null,
    radarRefreshTimer: null,
    radarCurrentIndex: -1,
    radarLoadedAt: 0,
    radarLoading: false,
    radarAnimationWanted: false,
    radarTileErrors: 0,
    location: null,
    locationMarker: null,
    accuracyCircle: null,
    watchId: null,
    nativeGps: {
      active: false,
      starting: false,
      plugin: null,
      lastError: null,
      syncTimer: null,
      lastSyncedTimestamp: 0,
      pointCount: 0,
      batteryUnrestricted: false
    },
    centerOnNextLocation: false,
    mapFollowGps: true,
    navigation: {
      orientationMode: 'auto', // auto | north | manual
      deviceHeading: null,
      deviceHeadingAt: 0,
      gpsHeading: null,
      orientationListening: false,
      orientationPermission: 'unknown',
      mapGestureActive: false,
      mapGestureAt: 0
    },
    route: null,
    routeLine: null,
    routeMarkers: [],
    mode: 'hike',
    deferredInstall: null,
    lastWeather: null,
    planner: {
      active: false,
      mode: 'hike',
      waypoints: [],
      markers: [],
      line: null,
      routePoints: [],
      routeTimer: null,
      lastRequestAt: 0,
      requestSerial: 0,
      routing: false,
      routeValid: false,
    },
    hikeFinder: {
      active: false,
      profile: 'hike',
      radiusKm: 5,
      center: null,
      centerMarker: null,
      resultLayer: null,
      previewLayer: null,
      results: [],
      loading: false,
      requestSerial: 0,
      selectedIndex: -1,
      mapLines: [],
      detailSerial: 0,
      detailSource: null,
    },
    elevationCharts: new Map(),
    elevationHoverMarker: null,
    routeDetailSerial: 0,
    activity: {
      status: 'idle', // idle | recording | paused | finished
      mode: 'hike',
      startedAt: null,
      pausedAt: null,
      pausedMs: 0,
      finishedAt: null,
      points: [],
      distanceKm: 0,
      currentSpeed: 0,
      line: null,
      timer: null,
      name: '',
      nativeSessionId: '',
      targetSelect: false,
      target: null,
      targetMarker: null,
      targetLine: null,
      followRoute: null,
      followRouteCumKm: null,
      followRouteLastIndex: null,
      offRouteAlerted: false,
      routeProgressMarker: null,
    }
  };

  const $ = id => document.getElementById(id);
  const ui = {
    locateBtn: $('locateBtn'), installBtn: $('installBtn'), gpsBadge: $('gpsBadge'),
    radarToggle: $('radarToggle'), radarPanel: $('radarPanel'), radarSlider: $('radarSlider'), radarPlay: $('radarPlay'), radarTime: $('radarTime'),
    mapWrap: $('mapWrap'), mapCloseBtn: $('mapCloseBtn'), mapLocateBtn: $('mapLocateBtn'), mapCompassBtn: $('mapCompassBtn'), mapZoomControls: $('mapZoomControls'), mapZoomInBtn: $('mapZoomInBtn'), mapZoomOutBtn: $('mapZoomOutBtn'), mapExpandHint: $('mapExpandHint'),
    tempNow: $('tempNow'), rainNow: $('rainNow'), gustNow: $('gustNow'), feelNow: $('feelNow'), elevationNow: $('elevationNow'), weatherIcon: $('weatherIcon'),
    alertCard: $('alertCard'), alertIcon: $('alertIcon'), alertTitle: $('alertTitle'), alertText: $('alertText'),
    gpxInput: $('gpxInput'), analyzeBtn: $('analyzeBtn'), routeCard: $('routeCard'), routeName: $('routeName'), routeDistance: $('routeDistance'), routeGain: $('routeGain'), routeLoss: $('routeLoss'), routeHigh: $('routeHigh'), routeForecast: $('routeForecast'), clearRouteBtn: $('clearRouteBtn'), exportRouteBtn: $('exportRouteBtn'), routeStartBtn: $('routeStartBtn'), routeShowBtn: $('routeShowBtn'),
    hourlyForecast: $('hourlyForecast'), refreshWeatherBtn: $('refreshWeatherBtn'), refreshWeatherIcon: $('refreshWeatherIcon'), refreshWeatherLabel: $('refreshWeatherLabel'), weatherUpdatedAt: $('weatherUpdatedAt'), toast: $('toast'),
    createRouteBtn: $('createRouteBtn'), plannerPanel: $('plannerPanel'), plannerStatus: $('plannerStatus'), plannerGpsBtn: $('plannerGpsBtn'), plannerUndoBtn: $('plannerUndoBtn'), plannerClearBtn: $('plannerClearBtn'), plannerSaveBtn: $('plannerSaveBtn'), plannerCloseBtn: $('plannerCloseBtn'),
    hikeFinderPanel: $('hikeFinderPanel'), hikeFinderStatus: $('hikeFinderStatus'), hikeFinderCloseBtn: $('hikeFinderCloseBtn'), hikeFinderGpsBtn: $('hikeFinderGpsBtn'), hikeFinderListBtn: $('hikeFinderListBtn'), hikeFinderMapResults: $('hikeFinderMapResults'), hikeFinderResultsCard: $('hikeFinderResultsCard'), hikeFinderResultsSummary: $('hikeFinderResultsSummary'), hikeFinderResultsList: $('hikeFinderResultsList'), hikeFinderNewSearchBtn: $('hikeFinderNewSearchBtn'), routesFindHikesBtn: $('routesFindHikesBtn'),
    finderMapDetail: $('finderMapDetail'), finderMapDetailToggle: $('finderMapDetailToggle'), finderMapDetailType: $('finderMapDetailType'), finderMapDetailName: $('finderMapDetailName'), finderMapDetailBody: $('finderMapDetailBody'), finderMapDetailClose: $('finderMapDetailClose'),
    finderDetailCard: $('finderDetailCard'), finderDetailType: $('finderDetailType'), finderDetailName: $('finderDetailName'), finderDetailBody: $('finderDetailBody'), finderDetailClose: $('finderDetailClose'),
    routeDuration: $('routeDuration'), routeDifficulty: $('routeDifficulty'), routeLow: $('routeLow'), routeSurface: $('routeSurface'), routeElevationSection: $('routeElevationSection'), routeElevationChart: $('routeElevationChart'), routeElevationHint: $('routeElevationHint'),
    savedRoutesCard: $('savedRoutesCard'), savedRoutesList: $('savedRoutesList'),
    activityOpenBtn: $('activityOpenBtn'), activityCard: $('activityCard'), activityTitle: $('activityTitle'), activityCloseCardBtn: $('activityCloseCardBtn'), activityStartBtn: $('activityStartBtn'), activityExportBtn: $('activityExportBtn'), activityStats: $('activityStats'), activityDistance: $('activityDistance'), activityTime: $('activityTime'), activitySpeed: $('activitySpeed'), activityAvgSpeed: $('activityAvgSpeed'), activityHelp: $('activityHelp'),
    activityMapPanel: $('activityMapPanel'), activityPanelToggle: $('activityPanelToggle'), activityMapTitle: $('activityMapTitle'), activityMapStatus: $('activityMapStatus'), activityMapDistance: $('activityMapDistance'), activityMapTime: $('activityMapTime'), activityMapSpeed: $('activityMapSpeed'), activityPauseBtn: $('activityPauseBtn'), activityStopBtn: $('activityStopBtn'),
    targetSelectBtn: $('targetSelectBtn'), targetGuide: $('targetGuide'), targetArrow: $('targetArrow'), targetDistance: $('targetDistance'), targetBearing: $('targetBearing'), targetEta: $('targetEta'), targetClearBtn: $('targetClearBtn'),
    routeFollowGuide: $('routeFollowGuide'), routeFollowName: $('routeFollowName'), routeFollowRemaining: $('routeFollowRemaining'), routeFollowProgress: $('routeFollowProgress'), routeFollowDeviation: $('routeFollowDeviation'),
    finishActivityModal: $('finishActivityModal'), finishSaveBtn: $('finishSaveBtn'), finishDiscardBtn: $('finishDiscardBtn'), finishCancelBtn: $('finishCancelBtn')
  };

  state.offline = {
    db: null,
    activePackage: null,
    layerGroup: null,
    forced: false,
    attributionAdded: false,
    preparing: false,
    lastAutoCheck: 0,
    pendingActivityPrepare: false
  };

  const offlineUI = {
    card: $('offlineCard'), networkBadge: $('offlineNetworkBadge'), sourceSelect: $('offlineSourceSelect'), bufferSelect: $('offlineBufferSelect'),
    prepareBtn: $('offlinePrepareBtn'), backOnlineBtn: $('offlineBackOnlineBtn'), progress: $('offlineProgress'), progressTitle: $('offlineProgressTitle'), progressText: $('offlineProgressText'),
    current: $('offlineCurrent'), currentName: $('offlineCurrentName'), list: $('offlineList')
  };

  function getActivityProfile(mode = state.activity.mode) {
    return ACTIVITY_PROFILES[mode] || ACTIVITY_PROFILES.hike;
  }

  function activityModeForRoute(route) {
    if (route?.plannerProfile && ACTIVITY_PROFILES[route.plannerProfile]) return route.plannerProfile;
    if (route?.transportMode === 'bike') return 'road';
    if (route?.transportMode === 'hike') return 'hike';
    return state.mode === 'bike' ? 'road' : 'hike';
  }

  function getPlannerProfile(mode = state.planner.mode) {
    return PLANNER_PROFILES[mode] || PLANNER_PROFILES.hike;
  }

  function applyRouteTransportMode(route) {
    if (!route) return;
    const nextMode = route.transportMode === 'bike' ? 'bike' : (route.transportMode === 'hike' ? 'hike' : null);
    if (!nextMode) return;
    state.mode = nextMode;
    document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === nextMode));
  }

  function initMap() {
    state.map = L.map('map', {
      zoomControl: false,
      preferCanvas: true,
      tap: true,
      rotate: true,
      bearing: 0,
      touchRotate: true,
      rotateControl: false
    }).setView([44.2, 6.7], 8);
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    state.baseLayers.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)'
    });
    state.baseLayers.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    });
    state.baseLayers.topo.addTo(state.map);

    state.map.on('click', handleMapClick);

    // Le plugin de rotation peut déclencher des événements Leaflet proches d'un drag
    // lors d'une rotation AUTOMATIQUE. On ne coupe donc le suivi GPS que si un
    // vrai geste du doigt est en cours sur la carte. Cela évite que le point bleu
    // parte hors écran alors que l'utilisateur n'a jamais déplacé la carte.
    const mapContainer = state.map.getContainer();
    const markMapGestureStart = () => {
      state.navigation.mapGestureActive = true;
      state.navigation.mapGestureAt = Date.now();
    };
    const markMapGestureEnd = () => {
      state.navigation.mapGestureActive = false;
    };
    if (window.PointerEvent) {
      mapContainer.addEventListener('pointerdown', markMapGestureStart, { passive: true });
      window.addEventListener('pointerup', markMapGestureEnd, { passive: true });
      window.addEventListener('pointercancel', markMapGestureEnd, { passive: true });
    } else {
      mapContainer.addEventListener('touchstart', markMapGestureStart, { passive: true });
      window.addEventListener('touchend', markMapGestureEnd, { passive: true });
      window.addEventListener('touchcancel', markMapGestureEnd, { passive: true });
      mapContainer.addEventListener('mousedown', markMapGestureStart, { passive: true });
      window.addEventListener('mouseup', markMapGestureEnd, { passive: true });
    }

    // Uniquement un glissement réellement initié par l'utilisateur suspend le suivi.
    // ◎ recentre immédiatement et réactive ensuite le suivi automatique.
    state.map.on('dragstart', () => {
      const userInitiated = state.navigation.mapGestureActive ||
        (Date.now() - Number(state.navigation.mapGestureAt || 0) < 500);
      if (!userInitiated || !state.mapFollowGps) return;
      state.mapFollowGps = false;
      stopAutomaticHeading();
      updateNavigationControls();
    });

    // Rotation volontaire à deux doigts : on respecte l'orientation choisie
    // par l'utilisateur et on suspend le mode cap automatique.
    state.map.on('rotatestart', () => {
      if (state.navigation.orientationMode !== 'auto') return;
      state.navigation.orientationMode = 'manual';
      stopAutomaticHeading();
      updateNavigationControls();
    });
    state.map.on('rotate', updateCompassRose);
    updateNavigationControls();
  }

  function handleMapClick(e) {
    if (state.hikeFinder.active) {
      searchHikesAround({ lat: e.latlng.lat, lon: e.latlng.lng });
      return;
    }
    if (!state.mapFullscreen && !state.planner.active && !state.activity.targetSelect) {
      enterMapFullscreen();
      return;
    }
    if (state.planner.active) {
      addPlannerWaypoint({ lat: e.latlng.lat, lon: e.latlng.lng });
      return;
    }
    if (state.activity.targetSelect) {
      setActivityTarget({ lat: e.latlng.lat, lon: e.latlng.lng });
    }
  }

  function enterMapFullscreen() {
    state.mapFullscreen = true;
    ui.mapWrap.classList.add('fullscreen');
    document.body.classList.add('map-fullscreen');
    ui.mapCloseBtn.classList.remove('hidden');
    ui.mapLocateBtn.classList.remove('hidden');
    ui.mapCompassBtn?.classList.remove('hidden');
    ui.mapZoomControls.classList.remove('hidden');
    syncActivityMapPanel();
    ensureOrientationTracking(false).catch(() => {});
    setTimeout(() => {
      state.map.invalidateSize();
      if (state.mapFollowGps && state.location) centerMapOnLocation(false);
      applyAutomaticHeading();
      updateNavigationControls();
    }, 50);
  }

  function exitMapFullscreen() {
    state.mapFullscreen = false;
    ui.mapWrap.classList.remove('fullscreen');
    document.body.classList.remove('map-fullscreen');
    ui.mapCloseBtn.classList.add('hidden');
    ui.mapLocateBtn.classList.add('hidden');
    ui.mapCompassBtn?.classList.add('hidden');
    ui.mapZoomControls.classList.add('hidden');
    stopAutomaticHeading();
    if (typeof state.map?.setBearing === 'function') state.map.setBearing(0);
    if (state.navigation.orientationMode === 'manual') state.navigation.orientationMode = 'north';
    syncActivityMapPanel();
    setTimeout(() => { state.map.invalidateSize(); updateNavigationControls(); }, 50);
  }

  function normalizeHeading(deg) {
    const n = Number(deg);
    return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
  }

  function screenOrientationAngle() {
    const angle = Number(screen?.orientation?.angle ?? window.orientation ?? 0);
    return Number.isFinite(angle) ? angle : 0;
  }

  function headingFromOrientationEvent(event) {
    if (!event) return null;
    if (Number.isFinite(Number(event.webkitCompassHeading))) {
      return normalizeHeading(Number(event.webkitCompassHeading) + screenOrientationAngle());
    }
    // alpha=0 quand le haut du téléphone pointe vers le Nord ; alpha augmente
    // dans le sens antihoraire. Un cap cartographique augmente dans le sens horaire.
    if ((event.absolute === true || event.type === 'deviceorientationabsolute') && Number.isFinite(Number(event.alpha))) {
      return normalizeHeading(360 - Number(event.alpha) + screenOrientationAngle());
    }
    return null;
  }

  function preferredNavigationHeading() {
    const gpsHeading = normalizeHeading(state.navigation.gpsHeading);
    const speed = Number(state.location?.speed);
    // En mouvement, le cap GPS est plus stable et correspond exactement à la trajectoire.
    if (gpsHeading != null && Number.isFinite(speed) && speed >= 3) return gpsHeading;
    const deviceFresh = Date.now() - Number(state.navigation.deviceHeadingAt || 0) < 2500;
    const deviceHeading = normalizeHeading(state.navigation.deviceHeading);
    if (deviceFresh && deviceHeading != null) return deviceHeading;
    return gpsHeading;
  }

  function stopAutomaticHeading() {
    if (!state.map) return;
    if (typeof state.map.setHeading === 'function') state.map.setHeading(null);
    else if (typeof state.map.stopHeadingUp === 'function') state.map.stopHeadingUp();
  }

  function applyAutomaticHeading() {
    if (!state.map || !state.mapFullscreen || !state.mapFollowGps) return;
    if (state.navigation.orientationMode !== 'auto') return;
    const heading = preferredNavigationHeading();
    if (heading == null || typeof state.map.setHeading !== 'function') return;
    state.map.setHeading(heading, { ease: 0.18, deadzone: 1.2 });
  }

  function updateCompassRose() {
    if (!ui.mapCompassBtn) return;
    const rose = ui.mapCompassBtn.querySelector('.compass-rose');
    const bearing = typeof state.map?.getBearing === 'function' ? Number(state.map.getBearing()) || 0 : 0;
    if (rose) rose.style.transform = `rotate(${bearing}deg)`;
  }

  function updateNavigationControls() {
    if (ui.mapLocateBtn) {
      ui.mapLocateBtn.classList.toggle('following', !!state.mapFollowGps);
      ui.mapLocateBtn.title = state.mapFollowGps ? 'Position suivie · toucher pour recentrer' : 'Reprendre le suivi de ma position';
    }
    if (!ui.mapCompassBtn) return;
    const mode = state.navigation.orientationMode;
    ui.mapCompassBtn.classList.toggle('auto', mode === 'auto');
    ui.mapCompassBtn.classList.toggle('north-locked', mode === 'north');
    ui.mapCompassBtn.classList.toggle('manual', mode === 'manual');
    ui.mapCompassBtn.classList.toggle('follow-paused', !state.mapFollowGps);
    const label = ui.mapCompassBtn.querySelector('.compass-mode');
    if (label) label.textContent = mode === 'auto' ? 'AUTO' : (mode === 'north' ? 'N' : 'MAN');
    const title = mode === 'auto'
      ? 'Orientation automatique active · toucher pour verrouiller le Nord'
      : (mode === 'north' ? 'Nord verrouillé · toucher pour orientation automatique' : 'Orientation manuelle · toucher pour revenir en automatique');
    ui.mapCompassBtn.title = title;
    ui.mapCompassBtn.setAttribute('aria-label', title);
    ui.mapCompassBtn.setAttribute('aria-pressed', mode === 'auto' ? 'true' : 'false');
    updateCompassRose();
  }

  function setOrientationMode(mode, { notify = false } = {}) {
    const next = ['auto','north','manual'].includes(mode) ? mode : 'north';
    state.navigation.orientationMode = next;
    stopAutomaticHeading();
    if (next === 'north') {
      try { state.map?.touchRotate?.disable?.(); } catch (_) {}
      if (typeof state.map?.setBearing === 'function') state.map.setBearing(0);
      if (notify) toast('🧭 Nord verrouillé · la carte ne tourne plus toute seule.');
    } else {
      try { state.map?.touchRotate?.enable?.(); } catch (_) {}
      if (next === 'auto') {
        applyAutomaticHeading();
        if (notify) toast('🧭 Orientation automatique activée.');
      }
    }
    updateNavigationControls();
  }

  function centerMapOnLocation(raiseZoom = false) {
    if (!state.location || !state.map) return false;
    const ll = [state.location.lat, state.location.lon];
    const currentZoom = state.map.getZoom();
    const zoom = raiseZoom ? Math.max(currentZoom, 15) : currentZoom;
    // setView est plus fiable que panTo avec leaflet-rotate : le point GPS
    // reste réellement au centre du viewport même lorsque la carte pivote.
    state.map.setView(ll, zoom, { animate: false });
    return true;
  }

  function enableGpsMapFollow({ raiseZoom = true } = {}) {
    state.mapFollowGps = true;
    state.centerOnNextLocation = !centerMapOnLocation(raiseZoom);
    updateNavigationControls();
    applyAutomaticHeading();
  }

  async function ensureOrientationTracking(fromUserGesture = false) {
    if (state.navigation.orientationListening) return true;
    if (!('DeviceOrientationEvent' in window)) return false;

    const requestPermission = window.DeviceOrientationEvent?.requestPermission;
    if (typeof requestPermission === 'function' && state.navigation.orientationPermission !== 'granted') {
      if (!fromUserGesture) return false;
      try {
        const result = await requestPermission.call(window.DeviceOrientationEvent);
        state.navigation.orientationPermission = result;
        if (result !== 'granted') return false;
      } catch (_) { return false; }
    } else {
      state.navigation.orientationPermission = 'granted';
    }

    const handle = event => {
      const heading = headingFromOrientationEvent(event);
      if (heading == null) return;
      state.navigation.deviceHeading = heading;
      state.navigation.deviceHeadingAt = Date.now();
      applyAutomaticHeading();
    };
    window.addEventListener('deviceorientationabsolute', handle, true);
    window.addEventListener('deviceorientation', handle, true);
    state.navigation.orientationListening = true;
    return true;
  }

  function switchBase(name) {
    if (state.offline?.activePackage) { toast('Carte en ligne indisponible en mode hors ligne.'); return; }
    if (!state.baseLayers[name] || name === state.activeBase) return;
    state.map.removeLayer(state.baseLayers[state.activeBase]);
    state.baseLayers[name].addTo(state.map);
    state.activeBase = name;
    document.querySelectorAll('[data-basemap]').forEach(btn => btn.classList.toggle('active', btn.dataset.basemap === name));
  }

  function persistRadarPrefs() {
    try {
      localStorage.setItem(RADAR_PREF_KEY, JSON.stringify({
        enabled: !!state.radarEnabled,
        animationWanted: !!state.radarAnimationWanted
      }));
    } catch (_) {}
  }

  function restoreRadarPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem(RADAR_PREF_KEY) || 'null');
      if (prefs && typeof prefs === 'object') {
        if (typeof prefs.enabled === 'boolean') state.radarEnabled = prefs.enabled;
        if (typeof prefs.animationWanted === 'boolean') state.radarAnimationWanted = prefs.animationWanted;
      }
    } catch (_) {}
    ui.radarToggle.classList.toggle('active', state.radarEnabled);
    ui.radarPanel.classList.toggle('hidden', !state.radarEnabled);
  }

  function stopRadarAnimation({ keepWanted = false } = {}) {
    if (state.radarTimer) clearInterval(state.radarTimer);
    state.radarTimer = null;
    ui.radarPlay.textContent = '▶';
    if (!keepWanted) {
      state.radarAnimationWanted = false;
      persistRadarPrefs();
    }
  }

  function startRadarAnimation() {
    if (!state.radarFrames.length || !state.radarEnabled || !navigator.onLine || state.offline?.activePackage) return false;
    if (state.radarTimer) clearInterval(state.radarTimer);
    state.radarAnimationWanted = true;
    persistRadarPrefs();
    ui.radarPlay.textContent = '⏸';
    state.radarTimer = setInterval(() => {
      let i = Number(ui.radarSlider.value);
      if (!Number.isFinite(i)) i = state.radarCurrentIndex >= 0 ? state.radarCurrentIndex : state.radarFrames.length - 1;
      i += 1;
      if (i >= state.radarFrames.length) i = 0;
      showRadarFrame(i);
    }, 650);
    return true;
  }

  function startRadarRefreshTimer() {
    if (state.radarRefreshTimer) clearInterval(state.radarRefreshTimer);
    state.radarRefreshTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || state.offline?.activePackage || !state.radarEnabled) return;
      loadRadar({ preserveSelection: true, silent: true }).catch(() => {});
    }, 5 * 60 * 1000);
  }

  async function fetchRadarMetadataWithRetry() {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      try {
        const res = await fetch(`https://api.rainviewer.com/public/weather-maps.json?_=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`Radar HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.host || !(data.radar?.past || []).length) throw new Error('Aucune image radar');
        clearTimeout(timer);
        return data;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw lastErr || new Error('Radar indisponible');
  }

  async function loadRadar({ preserveSelection = false, silent = false } = {}) {
    if (!navigator.onLine || state.offline?.activePackage) {
      ui.radarTime.textContent = 'Radar hors ligne';
      stopRadarAnimation({ keepWanted: true });
      return false;
    }
    if (state.radarLoading) return false;
    state.radarLoading = true;
    const oldFrame = state.radarFrames[state.radarCurrentIndex >= 0 ? state.radarCurrentIndex : Number(ui.radarSlider.value)];
    const oldTime = preserveSelection ? Number(oldFrame?.time) : NaN;
    const wanted = state.radarAnimationWanted;
    try {
      const data = await fetchRadarMetadataWithRetry();
      state.radarHost = data.host;
      state.radarFrames = data.radar?.past || [];
      state.radarLoadedAt = Date.now();
      state.radarTileErrors = 0;
      ui.radarSlider.max = String(state.radarFrames.length - 1);
      let index = state.radarFrames.length - 1;
      if (Number.isFinite(oldTime)) {
        let bestDiff = Infinity;
        state.radarFrames.forEach((frame, i) => {
          const diff = Math.abs(Number(frame.time) - oldTime);
          if (diff < bestDiff) { bestDiff = diff; index = i; }
        });
      }
      showRadarFrame(index);
      startRadarRefreshTimer();
      if (wanted && document.visibilityState === 'visible') startRadarAnimation();
      return true;
    } catch (err) {
      // Si des images avaient déjà été chargées, on les garde au lieu de casser
      // complètement le radar lors d'une micro-coupure 4G/Wi-Fi.
      if (state.radarFrames.length) {
        const i = Math.max(0, Math.min(state.radarCurrentIndex >= 0 ? state.radarCurrentIndex : state.radarFrames.length - 1, state.radarFrames.length - 1));
        showRadarFrame(i);
        if (!silent) toast('Radar temporairement indisponible · dernière animation conservée.');
      } else {
        ui.radarTime.textContent = 'Radar indisponible';
        if (!silent) toast('Impossible de charger le radar pour le moment.');
      }
      return false;
    } finally {
      state.radarLoading = false;
    }
  }

  function showRadarFrame(index) {
    if (!state.radarFrames.length || !state.radarHost) return;
    index = Math.max(0, Math.min(index, state.radarFrames.length - 1));
    const frame = state.radarFrames[index];
    state.radarCurrentIndex = index;
    if (state.radarLayer) state.map.removeLayer(state.radarLayer);
    const url = `${state.radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
    state.radarLayer = L.tileLayer(url, {
      opacity: 0.62,
      maxNativeZoom: 7,
      maxZoom: 19,
      tileSize: 256,
      updateWhenIdle: false,
      keepBuffer: 2,
      attribution: 'Weather radar © RainViewer'
    });
    state.radarLayer.on('tileerror', () => {
      state.radarTileErrors += 1;
      if (state.radarTileErrors === 5 && navigator.onLine && document.visibilityState === 'visible') {
        setTimeout(() => loadRadar({ preserveSelection:true, silent:true }).catch(() => {}), 1200);
      }
    });
    if (state.radarEnabled) state.radarLayer.addTo(state.map);
    ui.radarSlider.value = String(index);
    const d = new Date(frame.time * 1000);
    ui.radarTime.textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function toggleRadar() {
    if (state.offline?.activePackage || !navigator.onLine) { toast('Le radar nécessite une connexion Internet.'); return; }
    state.radarEnabled = !state.radarEnabled;
    ui.radarToggle.classList.toggle('active', state.radarEnabled);
    ui.radarPanel.classList.toggle('hidden', !state.radarEnabled);
    persistRadarPrefs();
    if (!state.radarEnabled) {
      stopRadarAnimation({ keepWanted: false });
      if (state.radarLayer && state.map.hasLayer(state.radarLayer)) state.map.removeLayer(state.radarLayer);
      return;
    }
    if (!state.radarLayer || Date.now() - state.radarLoadedAt > 2 * 60 * 1000) {
      loadRadar({ preserveSelection:true, silent:false }).catch(() => {});
    } else if (!state.map.hasLayer(state.radarLayer)) {
      state.radarLayer.addTo(state.map);
    }
  }

  function toggleRadarAnimation() {
    if (state.radarTimer) {
      stopRadarAnimation({ keepWanted:false });
      return;
    }
    if (!state.radarFrames.length) {
      state.radarAnimationWanted = true;
      persistRadarPrefs();
      loadRadar({ preserveSelection:false, silent:false }).then(ok => { if (ok) startRadarAnimation(); });
      return;
    }
    startRadarAnimation();
  }

  async function resumeRadarAfterForeground() {
    if (!state.radarEnabled || !navigator.onLine || state.offline?.activePackage) return;
    const stale = !state.radarFrames.length || Date.now() - state.radarLoadedAt > 90 * 1000;
    if (stale) await loadRadar({ preserveSelection:true, silent:true });
    else if (state.radarLayer && !state.map.hasLayer(state.radarLayer)) state.radarLayer.addTo(state.map);
    if (state.radarAnimationWanted) startRadarAnimation();
  }

  function getNativeActivityTracker() {
    const cap = window.Capacitor;
    if (!cap) return null;
    const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
    if (platform !== 'android') return null;
    const plugin = cap.Plugins?.RandoRadarTracker || null;
    if (!plugin || typeof plugin.startTracking !== 'function' || typeof plugin.getPoints !== 'function') return null;
    state.nativeGps.plugin = plugin;
    return plugin;
  }

  function nativeActivitySessionId() {
    return state.activity.nativeSessionId || '';
  }

  function makeNativeActivitySessionId() {
    return `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function startNativeSyncTimer() {
    clearInterval(state.nativeGps.syncTimer);
    state.nativeGps.syncTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && ['recording','paused','finished'].includes(state.activity.status)) {
        syncNativeActivityTrack().catch(() => {});
      }
    }, 1500);
  }

  function ensureActivityUiTimer() {
    clearInterval(state.activity.timer);
    state.activity.timer = null;
    if (['recording','paused','finished'].includes(state.activity.status)) {
      state.activity.timer = setInterval(updateActivityUI, 1000);
      updateActivityUI();
    }
  }

  async function recoverNativeActivityState({ reason = 'resume', allowRestart = true } = {}) {
    const plugin = getNativeActivityTracker();
    if (!plugin) return false;

    let nativeStatus = null;
    if (typeof plugin.getStatus === 'function') {
      try { nativeStatus = await plugin.getStatus(); }
      catch (err) { console.warn('État GPS natif illisible', err); }
    }

    const nativeSessionId = String(nativeStatus?.sessionId || '').trim();
    const nativeActive = nativeStatus?.active === true;

    // Si le service Android connaît une activité active, il devient la source de vérité,
    // même si Android a détruit la WebView ou si localStorage n'a pas eu le temps d'écrire.
    if (nativeActive && nativeSessionId) {
      const nativeMode = ACTIVITY_PROFILES[nativeStatus?.mode] ? nativeStatus.mode : (ACTIVITY_PROFILES[state.activity.mode] ? state.activity.mode : 'hike');
      const nativeStartedAt = Number(nativeStatus?.startedAt) || Number(state.activity.startedAt) || Date.now();

      if (!['recording','paused'].includes(state.activity.status) || state.activity.nativeSessionId !== nativeSessionId) {
        clearActivityTrack();
        clearActivityTarget();
        state.activity.status = 'recording';
        state.activity.mode = nativeMode;
        state.activity.startedAt = nativeStartedAt;
        state.activity.pausedAt = null;
        state.activity.pausedMs = Number(state.activity.pausedMs) || 0;
        state.activity.finishedAt = null;
        state.activity.points = [];
        state.activity.distanceKm = 0;
        state.activity.currentSpeed = 0;
        state.activity.nativeSessionId = nativeSessionId;
        state.activity.name = nativeStatus?.activityName || `${getActivityProfile(nativeMode).label} restaurée`;
        state.activity.line = L.polyline([], { color:'#fb7185', weight:5, opacity:.96 }).addTo(state.map);
      } else {
        state.activity.nativeSessionId = nativeSessionId;
        state.activity.startedAt = nativeStartedAt;
        state.activity.mode = nativeMode;
        if (nativeStatus?.activityName) state.activity.name = nativeStatus.activityName;
      }

      state.nativeGps.active = true;
      state.nativeGps.lastError = null;
      startNativeSyncTimer();
      ensureActivityUiTimer();
      await syncNativeActivityTrack(true);
      if (state.activity.status === 'recording') enableGpsMapFollow({ raiseZoom: false });
      persistActivitySnapshot(true);
      syncActivityMapPanel();
      return true;
    }

    // Si la WebView se souvient d'une activité en cours mais que le service a été
    // tué par Android, le relancer sans effacer le fichier de trace existant.
    if (allowRestart && state.activity.status === 'recording' && state.activity.nativeSessionId) {
      const restarted = await startNativeActivityLocation({ clear:false });
      ensureActivityUiTimer();
      if (restarted) {
        await syncNativeActivityTrack(true);
        persistActivitySnapshot(true);
        return true;
      }
    }

    if (['recording','paused','finished'].includes(state.activity.status)) ensureActivityUiTimer();
    return false;
  }

  async function startNativeActivityLocation({ clear = false } = {}) {
    if (state.nativeGps.starting) return false;
    const plugin = getNativeActivityTracker();
    const sessionId = nativeActivitySessionId();
    if (!plugin || !sessionId) return false;

    state.nativeGps.starting = true;
    state.nativeGps.lastError = null;
    const profile = getActivityProfile();
    ui.gpsBadge.textContent = 'GPS natif : démarrage…';

    try {
      await plugin.startTracking({
        sessionId,
        clear: Boolean(clear),
        startedAt: Number(state.activity.startedAt) || Date.now(),
        mode: state.activity.mode || 'hike',
        activityName: state.activity.name || '',
        minTimeMs: profile.cycling ? 1800 : 2500,
        minDistanceM: profile.cycling ? 3 : 2,
        maxAccuracyM: profile.nativeAccuracy || (profile.cycling ? 40 : 30),
        maxSpeedKmh: profile.nativeMaxSpeed || 160
      });
      state.nativeGps.active = true;
      state.nativeGps.lastSyncedTimestamp = 0;
      state.nativeGps.pointCount = 0;
      ui.gpsBadge.textContent = 'GPS natif : actif';
      ui.activityMapStatus.textContent = 'GPS NATIF · trace enregistrée écran éteint';
      startNativeSyncTimer();
      await syncNativeActivityTrack(true);
      return true;
    } catch (err) {
      state.nativeGps.lastError = err;
      state.nativeGps.active = false;
      console.warn('Enregistreur GPS natif indisponible, repli GPS navigateur.', err);
      return false;
    } finally {
      state.nativeGps.starting = false;
    }
  }

  async function stopNativeActivityLocation() {
    clearInterval(state.nativeGps.syncTimer);
    state.nativeGps.syncTimer = null;
    const plugin = state.nativeGps.plugin || getNativeActivityTracker();
    if (!plugin || !nativeActivitySessionId()) {
      state.nativeGps.active = false;
      return;
    }
    try { await syncNativeActivityTrack(true); } catch (_) {}
    try { await plugin.stopTracking({ sessionId: nativeActivitySessionId() }); }
    catch (err) { console.warn('Arrêt enregistreur GPS natif impossible', err); }
    state.nativeGps.active = false;
    state.nativeGps.starting = false;
  }

  function nativePointToActivityPoint(raw) {
    if (!raw) return null;
    const lat = Number(raw.lat ?? raw.latitude);
    const lon = Number(raw.lon ?? raw.longitude);
    const timestamp = Number(raw.timestamp ?? raw.time);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) return null;
    return {
      lat,
      lon,
      ele: Number.isFinite(Number(raw.altitude)) ? Number(raw.altitude) : null,
      time: new Date(timestamp).toISOString(),
      timestamp,
      accuracy: Number.isFinite(Number(raw.accuracy)) ? Number(raw.accuracy) : null,
      speedKmh: Number.isFinite(Number(raw.speedKmh)) ? Math.max(0, Number(raw.speedKmh)) : null,
      bearing: Number.isFinite(Number(raw.bearing)) ? normalizeHeading(Number(raw.bearing)) : null
    };
  }

  function applyNativePointToLiveMap(point) {
    if (!point || !state.map) return;
    const timestamp = Number(point.timestamp) || Date.now();
    const existingTs = Number(state.location?.timestamp) || 0;
    // Le GPS natif est la référence pendant l'activité. On ignore seulement un
    // point manifestement plus ancien que la dernière position déjà affichée.
    if (existingTs && timestamp + 1500 < existingTs) return;

    state.location = {
      lat: point.lat,
      lon: point.lon,
      accuracy: Number.isFinite(point.accuracy) ? point.accuracy : null,
      altitude: Number.isFinite(point.ele) ? point.ele : null,
      speed: Number.isFinite(point.speedKmh) ? point.speedKmh : null,
      heading: Number.isFinite(point.bearing) ? normalizeHeading(point.bearing) : null,
      timestamp
    };
    if (state.location.heading != null) state.navigation.gpsHeading = state.location.heading;

    const ll = [point.lat, point.lon];
    if (!state.locationMarker) {
      const icon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [18,18], iconAnchor:[9,9] });
      state.locationMarker = L.marker(ll, { icon, zIndexOffset: 1000 }).addTo(state.map);
      state.accuracyCircle = L.circle(ll, {
        radius: Number.isFinite(point.accuracy) ? point.accuracy : 10,
        weight: 1, fillOpacity: .07, opacity: .35
      }).addTo(state.map);
    } else {
      state.locationMarker.setLatLng(ll);
      state.accuracyCircle?.setLatLng(ll).setRadius(Number.isFinite(point.accuracy) ? point.accuracy : 10);
    }

    ui.gpsBadge.textContent = Number.isFinite(point.accuracy)
      ? `GPS natif : ±${Math.round(point.accuracy)} m`
      : 'GPS natif : actif';
    if (Number.isFinite(point.ele)) ui.elevationNow.textContent = `${Math.round(point.ele)} m`;

    // IMPORTANT : la caméra suit maintenant exactement la même position native
    // que celle enregistrée dans la trace. setView est volontairement utilisé
    // plutôt que panTo, plus fiable avec la carte rotative Leaflet.
    if (state.mapFollowGps || state.centerOnNextLocation) {
      centerMapOnLocation(state.centerOnNextLocation);
      state.centerOnNextLocation = false;
    }
    applyAutomaticHeading();
    updateNavigationControls();
  }

  function replaceActivityTrackFromNative(points) {
    if (!Array.isArray(points)) return;
    const clean = points.map(nativePointToActivityPoint).filter(Boolean).sort((a,b) => a.timestamp - b.timestamp);
    if (!clean.length) return;

    state.activity.points = clean;
    state.activity.distanceKm = clean.length > 1 ? routeDistance(clean) : 0;
    const last = clean[clean.length - 1];
    const prev = clean.length > 1 ? clean[clean.length - 2] : null;
    applyNativePointToLiveMap(last);
    if (Number.isFinite(last.speedKmh)) {
      state.activity.currentSpeed = last.speedKmh;
    } else if (prev) {
      const dt = Math.max(0.5, (last.timestamp - prev.timestamp) / 1000);
      state.activity.currentSpeed = (haversine(prev, last) / dt) * 3600;
    } else {
      state.activity.currentSpeed = 0;
    }
    state.nativeGps.lastSyncedTimestamp = last.timestamp;
    if (Number.isFinite(last.bearing)) { state.navigation.gpsHeading = last.bearing; applyAutomaticHeading(); }

    if (!state.activity.line) {
      state.activity.line = L.polyline([], { color:'#fb7185', weight:5, opacity:.96 }).addTo(state.map);
    }
    state.activity.line.setLatLngs(clean.map(p => [p.lat, p.lon]));
    updateActivityUI();
    // Après une réouverture, le dernier point natif doit également remettre à jour
    // l'avancement du GPX/profil altimétrique, pas seulement la trace rose.
    if (state.activity.followRoute && state.location) updateRouteFollowGuide(state.location);
    persistActivitySnapshot();
  }

  async function syncNativeActivityTrack(force = false) {
    const plugin = getNativeActivityTracker();
    const sessionId = nativeActivitySessionId();
    if (!plugin || !sessionId) return false;
    try {
      const result = await plugin.getPoints({ sessionId });
      const points = Array.isArray(result?.points) ? result.points : [];
      state.nativeGps.pointCount = points.length;
      state.nativeGps.batteryUnrestricted = result?.batteryUnrestricted === true;
      if (!points.length) return false;
      const newest = Number(points[points.length - 1]?.timestamp ?? points[points.length - 1]?.time) || 0;
      if (!force && newest && newest <= state.nativeGps.lastSyncedTimestamp) {
        if (Date.now() - newest > 12000) {
          state.activity.currentSpeed = 0;
          updateActivityUI();
        }
        return true;
      }
      replaceActivityTrackFromNative(points);
      return true;
    } catch (err) {
      if (force) console.warn('Lecture trace GPS native impossible', err);
      return false;
    }
  }


  function startLocation(center = true, { forceWeb = false } = {}) {
    if (center) {
      enableGpsMapFollow({ raiseZoom: true });
      ensureOrientationTracking(false).catch(() => {});
    }

    // Dans l’APK Android, le service natif enregistre la trace indépendamment de la WebView.
    // Le GPS navigateur reste actif uniquement pour déplacer le point bleu et les aides à l’écran.

    if (!('geolocation' in navigator)) {
      toast('La géolocalisation n’est pas disponible sur cet appareil.');
      return;
    }

    if (state.watchId !== null) return;
    ui.gpsBadge.textContent = 'GPS : recherche…';
    state.watchId = navigator.geolocation.watchPosition(
      updateLocation,
      err => {
        ui.gpsBadge.textContent = 'GPS : erreur';
        toast(err.code === 1 ? 'Autorise la localisation pour utiliser le GPS.' : 'Position GPS indisponible.');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  function updateLocation(pos) {
    const { latitude, longitude, accuracy, altitude, speed, heading } = pos.coords;
    // Pendant une activité native, le service Android est la source de vérité
    // pour le point bleu et la caméra. Le GPS Web reste un simple repli.
    if (state.nativeGps.active && state.activity.nativeSessionId) {
      const webTs = Number(pos.timestamp || Date.now());
      const liveTs = Number(state.location?.timestamp || 0);
      if (liveTs && webTs <= liveTs + 2000) return;
    }
    state.location = {
      lat: latitude,
      lon: longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      altitude: Number.isFinite(altitude) ? altitude : null,
      speed: Number.isFinite(speed) ? speed * 3.6 : null,
      heading: Number.isFinite(heading) ? normalizeHeading(heading) : null,
      timestamp: pos.timestamp || Date.now()
    };
    if (state.location.heading != null) state.navigation.gpsHeading = state.location.heading;
    const ll = [latitude, longitude];

    if (!state.locationMarker) {
      const icon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [18,18], iconAnchor:[9,9] });
      state.locationMarker = L.marker(ll, { icon, zIndexOffset: 1000 }).addTo(state.map);
      state.accuracyCircle = L.circle(ll, { radius: accuracy || 10, weight: 1, fillOpacity: .07, opacity: .35 }).addTo(state.map);
    } else {
      state.locationMarker.setLatLng(ll);
      state.accuracyCircle.setLatLng(ll).setRadius(accuracy || 10);
    }

    ui.gpsBadge.textContent = `${state.nativeGps.active ? 'GPS natif' : 'GPS'} : ±${Math.round(accuracy || 0)} m`;
    if (Number.isFinite(altitude)) ui.elevationNow.textContent = `${Math.round(altitude)} m`;

    if (state.mapFollowGps || state.centerOnNextLocation) {
      centerMapOnLocation(state.centerOnNextLocation);
      state.centerOnNextLocation = false;
    }
    applyAutomaticHeading();
    updateNavigationControls();

    if (state.activity.status === 'recording' && !(state.activity.nativeSessionId && getNativeActivityTracker())) recordActivityPoint(state.location);
    if (state.activity.followRoute) updateRouteFollowGuide(state.location);
    if (state.activity.target) updateTargetGuide();
    if (['recording','paused'].includes(state.activity.status)) persistActivitySnapshot();
    scheduleWeather(latitude, longitude);

    // Si une activité libre vient de démarrer avant d'obtenir le premier point GPS,
    // prépare automatiquement la zone hors ligne dès que la position devient disponible.
    if (state.offline.pendingActivityPrepare && navigator.onLine && !state.offline.preparing) {
      state.offline.pendingActivityPrepare = false;
      autoPrepareOfflineForActivity(null).catch(() => {});
    }

    // Hors ligne : si l'utilisateur sort de la zone active, cherche silencieusement
    // une autre carte locale couvrant la nouvelle position (au maximum toutes les 20 s).
    if (!navigator.onLine && !state.offline.forced && Date.now() - (state.offline.lastAutoCheck || 0) > 20000) {
      state.offline.lastAutoCheck = Date.now();
      if (!state.offline.activePackage || !bboxContains(state.offline.activePackage.bbox, state.location)) {
        chooseOfflinePackageForCurrentPosition().then(pkg => {
          if (pkg && pkg.id !== state.offline.activePackage?.id) activateOfflinePackage(pkg, { fit:false, forced:false });
        }).catch(() => {});
      }
    }
  }

  let weatherDebounce = null;
  let lastWeatherKey = '';
  function scheduleWeather(lat, lon) {
    if (!navigator.onLine) return;
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (key === lastWeatherKey) return;
    clearTimeout(weatherDebounce);
    weatherDebounce = setTimeout(() => {
      lastWeatherKey = key;
      loadWeather(lat, lon, { silent: true });
    }, 600);
  }

  async function loadWeather(lat, lon, { silent = false } = {}) {
    if (!navigator.onLine) {
      const saved = state.offline?.activePackage?.weather || state.lastWeather;
      if (saved) {
        state.lastWeather = saved;
        renderCurrentWeather(saved);
        renderHourly(saved);
        if (ui.weatherUpdatedAt) ui.weatherUpdatedAt.textContent = `Météo enregistrée : ${formatOfflineDate(state.offline?.activePackage?.weatherSavedAt)}`;
        if (!silent) toast('Hors ligne : dernière météo enregistrée affichée.');
        return true;
      }
      if (!silent) toast('Aucune météo enregistrée hors ligne.');
      return false;
    }
    try {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
        hourly: 'temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m',
        forecast_days: '2',
        timezone: 'auto'
      });
      const res = await fetch(`https://api.open-meteo.com/v1/meteofrance?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Météo indisponible');
      const data = await res.json();
      state.lastWeather = data;
      renderCurrentWeather(data);
      renderHourly(data);
      if (data.elevation != null) ui.elevationNow.textContent = `${Math.round(data.elevation)} m`;
      const t = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (ui.weatherUpdatedAt) ui.weatherUpdatedAt.textContent = `Dernière mise à jour : ${t}`;
      if (!silent) toast(`Météo actualisée à ${t}.`);
      return true;
    } catch (err) {
      if (!silent) toast('Impossible de récupérer la météo locale.');
      return false;
    }
  }

  async function refreshWeatherNow() {
    if (!navigator.onLine) { toast('Pas de réseau : affichage de la dernière météo enregistrée.'); return; }
    if (ui.refreshWeatherBtn.disabled) return;

    // Retour visuel immédiat : la flèche tourne pendant TOUTE l'opération,
    // y compris pendant l'obtention éventuelle d'une position GPS fraîche.
    ui.refreshWeatherBtn.disabled = true;
    ui.refreshWeatherBtn.classList.add('refreshing');
    ui.refreshWeatherBtn.setAttribute('aria-busy', 'true');
    if (ui.refreshWeatherLabel) ui.refreshWeatherLabel.textContent = 'Actualisation…';

    try {
      let lat = state.location?.lat;
      let lon = state.location?.lon;

      // Au clic, demander une position fraîche plutôt que de réutiliser
      // silencieusement une ancienne position du suivi GPS.
      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              maximumAge: 0,
              timeout: 10000
            });
          });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        } catch (_) {
          // Si un suivi GPS est déjà actif, la dernière position connue reste
          // un repli valable. Sinon on affiche une erreur explicite ci-dessous.
        }
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        toast('Position GPS indisponible pour actualiser la météo.');
        return;
      }

      await loadWeather(lat, lon);
    } finally {
      ui.refreshWeatherBtn.disabled = false;
      ui.refreshWeatherBtn.classList.remove('refreshing');
      ui.refreshWeatherBtn.removeAttribute('aria-busy');
      if (ui.refreshWeatherLabel) ui.refreshWeatherLabel.textContent = 'Actualiser';
    }
  }

  function renderCurrentWeather(data) {
    const c = data.current || {};
    ui.tempNow.textContent = number(c.temperature_2m, 0, '--');
    ui.rainNow.textContent = `${number(c.precipitation, 1, '--')} mm`;
    ui.gustNow.textContent = `${number(c.wind_gusts_10m, 0, '--')} km/h`;
    ui.feelNow.textContent = `${number(c.apparent_temperature, 0, '--')}°`;
    ui.weatherIcon.textContent = weatherEmoji(c.weather_code);

    const rain = Number(c.precipitation || 0);
    const gust = Number(c.wind_gusts_10m || 0);
    if (rain >= 4 || gust >= 70) setAlert('danger', '⚠️', 'Conditions difficiles', `Pluie ${rain.toFixed(1)} mm et rafales ${Math.round(gust)} km/h actuellement.`);
    else if (rain > 0.2 || gust >= 45) setAlert('warn', '🌦️', 'Conditions à surveiller', `Pluie ${rain.toFixed(1)} mm · rafales ${Math.round(gust)} km/h actuellement.`);
    else if (state.activity.status === 'idle' || state.activity.status === 'finished') setAlert('safe', '✅', 'Conditions locales calmes', `Pas de signal météo fort à ta position. Rafales ${Math.round(gust)} km/h.`);
  }

  function renderHourly(data) {
    const h = data.hourly;
    if (!h?.time?.length) return;
    const now = Date.now();
    const items = [];
    for (let i = 0; i < h.time.length && items.length < 10; i++) {
      const t = new Date(h.time[i]).getTime();
      if (t < now - 30 * 60 * 1000) continue;
      items.push({
        time: new Date(h.time[i]), temp: h.temperature_2m[i], rain: h.precipitation[i], pop: h.precipitation_probability?.[i], code: h.weather_code[i], gust: h.wind_gusts_10m[i]
      });
    }
    ui.hourlyForecast.innerHTML = items.map(x => `
      <div class="hour-card">
        <div class="time">${x.time.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</div>
        <div class="ico">${weatherEmoji(x.code)}</div>
        <div class="temp">${Math.round(x.temp)}°</div>
        <div class="rain">${x.pop ?? '--'}% · ${Number(x.rain || 0).toFixed(1)}mm</div>
      </div>`).join('');
  }

  function setAlert(level, icon, title, text) {
    ui.alertCard.className = `alert-card ${level}`;
    ui.alertIcon.textContent = icon;
    ui.alertTitle.textContent = title;
    ui.alertText.textContent = text;
  }

  // ---------- GPX / parcours ----------

  async function importGpx(file) {
    try {
      const text = await file.text();
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('GPX illisible');
      const trkpts = [...xml.querySelectorAll('trkpt')];
      const rtepts = [...xml.querySelectorAll('rtept')];
      const nodes = trkpts.length ? trkpts : rtepts;
      if (nodes.length < 2) throw new Error('Aucun tracé exploitable');
      const pts = nodes.map(n => ({
        lat: Number(n.getAttribute('lat')),
        lon: Number(n.getAttribute('lon')),
        ele: n.querySelector('ele') ? Number(n.querySelector('ele').textContent) : null,
        time: n.querySelector('time')?.textContent || null
      })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (pts.length < 2) throw new Error('Tracé vide');
      const name = xml.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() || file.name.replace(/\.gpx$/i, '');
      state.route = buildRouteObject(name, pts, { source: 'gpx' });
      drawRoute(true);
      renderRouteStats();
      toast(`Parcours chargé : ${state.route.distanceKm.toFixed(1)} km · tu peux maintenant le démarrer.`);
    } catch (err) {
      toast(err.message || 'Impossible de lire ce GPX.');
    }
  }

  function buildRouteObject(name, points, meta = {}) {
    const geometryPoints = Array.isArray(points) ? points : [];
    const distance = routeDistance(geometryPoints);
    const elevationStats = calculateSmoothedElevationStats(geometryPoints);
    return {
      name: name || 'Parcours',
      points: geometryPoints,
      distanceKm: distance,
      gain: elevationStats?.gain || 0,
      loss: elevationStats?.loss || 0,
      high: elevationStats?.high ?? null,
      low: elevationStats?.low ?? null,
      rawGain: elevationStats?.rawGain ?? null,
      rawLoss: elevationStats?.rawLoss ?? null,
      elevationProfile: elevationStats?.profile || meta.elevationProfile || null,
      elevationFiltered: Boolean(elevationStats),
      createdAt: Date.now(),
      ...meta
    };
  }

  // Une altitude absente (null/undefined/chaîne vide) ne doit jamais être
  // interprétée comme 0 m. JavaScript fait Number(null) === 0, ce qui avait
  // pour effet de considérer certains parcours sans relief comme entièrement
  // situés au niveau de la mer et empêchait l'appel à l'API d'altitude.
  function hasElevation(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  // Le D+/D− ne doit pas additionner le bruit de chaque cellule du modèle
  // d'altitude. On échantillonne d'abord le tracé à intervalles réguliers,
  // puis on applique un filtre médian + moyenne pondérée et enfin un seuil
  // vertical de 8 m. Une vraie descente/remontée > 8 m reste comptée ; les
  // petites oscillations parasites ne gonflent plus le dénivelé cumulé.
  function calculateSmoothedElevationStats(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const known = points.filter(p => hasElevation(p.ele)).length;
    if (known / points.length < .7) return null;

    const sampled = resampleRouteByDistance(points, 420).filter(p => hasElevation(p.ele));
    if (sampled.length < 2) return null;
    const raw = sampled.map(p => Number(p.ele));
    const rawChanges = cumulativeElevationWithDeadband(raw, 1);

    const median = raw.map((_, i) => {
      const vals = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3)).sort((a,b) => a-b);
      return vals[Math.floor(vals.length / 2)];
    });
    const weights = [1,2,3,2,1];
    const smooth = median.map((_, i) => {
      let sum = 0, wsum = 0;
      for (let k = -2; k <= 2; k++) {
        const idx = Math.max(0, Math.min(median.length - 1, i + k));
        const w = weights[k + 2];
        sum += median[idx] * w; wsum += w;
      }
      return sum / wsum;
    });
    // Conserver fidèlement les altitudes de départ/arrivée après filtrage médian.
    smooth[0] = median[0];
    smooth[smooth.length - 1] = median[median.length - 1];

    const filteredChanges = cumulativeElevationWithDeadband(smooth, 8);
    const profile = sampled.map((p, i) => ({ ...p, ele: Number(smooth[i].toFixed(1)) }));
    return {
      gain: filteredChanges.gain,
      loss: filteredChanges.loss,
      high: Math.max(...smooth),
      low: Math.min(...smooth),
      rawGain: rawChanges.gain,
      rawLoss: rawChanges.loss,
      profile
    };
  }

  function cumulativeElevationWithDeadband(values, threshold = 8) {
    if (!Array.isArray(values) || values.length < 2) return { gain: 0, loss: 0 };
    let gain = 0, loss = 0, reference = Number(values[0]);
    for (let i = 1; i < values.length; i++) {
      const current = Number(values[i]);
      if (!Number.isFinite(current)) continue;
      const delta = current - reference;
      if (delta >= threshold) { gain += delta; reference = current; }
      else if (delta <= -threshold) { loss += -delta; reference = current; }
    }
    // Le résidu final (< seuil) est ajouté uniquement s'il prolonge la tendance
    // générale, pour ne pas perdre les derniers mètres d'une montée/descente.
    const end = Number(values[values.length - 1]);
    if (Number.isFinite(end)) {
      const residual = end - reference;
      if (residual > 0) gain += residual;
      else if (residual < 0) loss += -residual;
    }
    return { gain, loss };
  }

  function resampleRouteByDistance(points, maxPoints = 420) {
    if (!Array.isArray(points) || points.length < 2) return (points || []).map(p => ({...p}));
    const cumulative = buildCumulativeRouteKm(points);
    const total = cumulative[cumulative.length - 1] || 0;
    if (total <= 0) return points.map(p => ({...p}));
    // Environ un point tous les 60 m, avec un plafond pour ne pas surcharger l'API altitude.
    const count = Math.max(2, Math.min(maxPoints, Math.ceil((total * 1000) / 60) + 1));
    const out = [];
    let seg = 1;
    for (let i = 0; i < count; i++) {
      const target = total * i / (count - 1);
      while (seg < cumulative.length - 1 && cumulative[seg] < target) seg++;
      const aIdx = Math.max(0, seg - 1), bIdx = Math.min(points.length - 1, seg);
      const a = points[aIdx], b = points[bIdx];
      const span = Math.max(1e-9, cumulative[bIdx] - cumulative[aIdx]);
      const t = Math.max(0, Math.min(1, (target - cumulative[aIdx]) / span));
      const aHasEle = hasElevation(a.ele), bHasEle = hasElevation(b.ele);
      const ae = aHasEle ? Number(a.ele) : null, be = bHasEle ? Number(b.ele) : null;
      let ele = null;
      if (aHasEle && bHasEle) ele = ae + (be - ae) * t;
      else if (aHasEle) ele = ae;
      else if (bHasEle) ele = be;
      out.push({
        lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * t,
        lon: Number(a.lon) + (Number(b.lon) - Number(a.lon)) * t,
        ele,
        // Conserver la distance exacte le long de la géométrie complète.
        // Recalculer la distance entre les points échantillonnés coupe les
        // lacets et raccourcit artificiellement le profil altimétrique.
        distKm: target,
        time: t < .5 ? (a.time || null) : (b.time || null)
      });
    }
    return out;
  }

  function drawRoute(fit = false) {
    if (!state.route) return;
    if (state.routeLine) state.map.removeLayer(state.routeLine);
    state.routeMarkers.forEach(m => state.map.removeLayer(m));
    state.routeMarkers = [];
    const latlngs = state.route.points.map(p => [p.lat, p.lon]);
    state.routeLine = L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: .95 }).addTo(state.map);
    if (fit && latlngs.length > 1) state.map.fitBounds(state.routeLine.getBounds(), { padding: [24,24] });
  }

  function renderRouteStats() {
    const r = state.route;
    if (!r) return;
    ui.routeCard.classList.remove('hidden');
    ui.routeName.textContent = r.name;
    ui.routeDistance.textContent = `${r.distanceKm.toFixed(1)} km`;
    ui.routeGain.textContent = r.high == null ? '—' : `${Math.round(r.gain)} m`;
    ui.routeLoss.textContent = r.high == null ? '—' : `${Math.round(r.loss)} m`;
    ui.routeHigh.textContent = r.high == null ? '—' : `${Math.round(r.high)} m`;
    applyRouteTransportMode(r);
    ui.analyzeBtn.disabled = false;
    ui.routeForecast.classList.add('hidden');
    ui.routeForecast.innerHTML = '';
    renderLoadedRouteDetails(r);
  }

  function clearRoute() {
    if (['recording','paused'].includes(state.activity.status) && state.activity.followRoute === state.route) {
      toast('Ce GPX est actuellement suivi. Termine l’activité avant de le retirer.');
      return;
    }
    if (state.routeLine) state.map.removeLayer(state.routeLine);
    state.routeMarkers.forEach(m => state.map.removeLayer(m));
    state.routeMarkers = [];
    state.routeLine = null;
    state.route = null;
    state.routeDetailSerial++;
    state.elevationCharts.delete('current-route');
    if (state.elevationHoverMarker) { state.map.removeLayer(state.elevationHoverMarker); state.elevationHoverMarker = null; }
    ui.routeCard.classList.add('hidden');
    ui.analyzeBtn.disabled = true;
    ui.gpxInput.value = '';
  }

  function exportCurrentRoute() {
    if (!state.route) return;
    downloadGpx(state.route.name, state.route.points, 'route');
  }

  function showCurrentRouteOnMap() {
    if (!state.route || !state.routeLine) return;
    showAppScreen('map', { scroll: false });
    setTimeout(() => {
      enterMapFullscreen();
      if (state.routeLine) state.map.fitBounds(state.routeLine.getBounds(), { padding: [34, 34] });
    }, 70);
  }

  function buildCumulativeRouteKm(points) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      cumulative[i] = cumulative[i - 1] + haversine(points[i - 1], points[i]);
    }
    return cumulative;
  }

  function startSelectedRouteActivity() {
    if (!state.route) {
      toast('Charge d’abord un parcours GPX.');
      return;
    }
    if (['recording','paused'].includes(state.activity.status)) {
      toast('Une activité est déjà en cours. Termine-la avant de démarrer ce parcours.');
      return;
    }
    state.activity.mode = activityModeForRoute(state.route);
    document.querySelectorAll('[data-activity-mode]').forEach(b => b.classList.toggle('active', b.dataset.activityMode === state.activity.mode));
    startActivity(state.route);
    showAppScreen('map', { scroll: false });
    setTimeout(() => enterMapFullscreen(), 60);
  }

  async function analyzeRoute() {
    if (!state.route) return;
    ui.analyzeBtn.disabled = true;
    const analyzeLabel = ui.analyzeBtn.querySelector('span:last-child');
    if (analyzeLabel) analyzeLabel.textContent = 'Analyse en cours…';
    try {
      const samples = sampleRoute(state.route.points, 6);
      const lats = samples.map(s => s.point.lat).join(',');
      const lons = samples.map(s => s.point.lon).join(',');
      const params = new URLSearchParams({
        latitude: lats,
        longitude: lons,
        hourly: 'temperature_2m,precipitation,weather_code,wind_gusts_10m',
        forecast_days: '2',
        timezone: 'auto'
      });
      const res = await fetch(`https://api.open-meteo.com/v1/meteofrance?${params}`);
      if (!res.ok) throw new Error('Analyse météo indisponible');
      let forecasts = await res.json();
      if (!Array.isArray(forecasts)) forecasts = [forecasts];
      const speed = state.mode === 'bike' ? 20 : 4;
      const now = Date.now();
      const results = samples.map((s, i) => {
        const f = forecasts[i] || forecasts[0];
        const eta = new Date(now + (s.distanceKm / speed) * 3600000);
        const idx = nearestTimeIndex(f.hourly?.time || [], eta);
        return {
          distanceKm: s.distanceKm,
          eta,
          temp: f.hourly?.temperature_2m?.[idx],
          precip: f.hourly?.precipitation?.[idx],
          gust: f.hourly?.wind_gusts_10m?.[idx],
          code: f.hourly?.weather_code?.[idx],
          point: s.point
        };
      });
      renderRouteForecast(results);
      summarizeRouteRisk(results);
    } catch (err) {
      toast(err.message || 'Impossible d’analyser le parcours.');
    } finally {
      ui.analyzeBtn.disabled = false;
      if (analyzeLabel) analyzeLabel.textContent = 'Analyser météo';
    }
  }

  function renderRouteForecast(results) {
    state.routeMarkers.forEach(m => state.map.removeLayer(m));
    state.routeMarkers = [];
    ui.routeForecast.innerHTML = results.map(r => {
      const risk = riskFor(r.precip, r.gust, r.code);
      const meta = `${r.eta.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})} · ${number(r.temp,0,'--')}° · raf. ${number(r.gust,0,'--')} km/h`;
      return `<div class="route-step">
        <div class="km">${r.distanceKm.toFixed(1)} km</div>
        <div class="desc"><strong>${weatherEmoji(r.code)} ${weatherText(r.code)}</strong><div class="meta">${meta}</div></div>
        <div class="risk">${risk.emoji} ${number(r.precip,1,'--')}mm</div>
      </div>`;
    }).join('');
    ui.routeForecast.classList.remove('hidden');

    results.forEach((r, idx) => {
      if (idx === 0 || idx === results.length - 1) return;
      const icon = L.divIcon({ className: '', html: '<div class="route-marker"></div>', iconSize:[10,10], iconAnchor:[5,5] });
      state.routeMarkers.push(L.marker([r.point.lat, r.point.lon], { icon, interactive:false }).addTo(state.map));
    });
  }

  function summarizeRouteRisk(results) {
    const ranked = results.map(r => ({...r, risk: riskFor(r.precip, r.gust, r.code)})).sort((a,b) => b.risk.score - a.risk.score);
    const worst = ranked[0];
    if (!worst || worst.risk.score === 0) {
      setAlert('safe', '✅', 'Parcours plutôt favorable', 'Aucun signal fort détecté aux points analysés du parcours.');
      return;
    }
    const when = worst.eta.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
    const text = `Vers ${worst.distanceKm.toFixed(1)} km (~${when}) : ${number(worst.precip,1,'--')} mm de pluie, rafales ${number(worst.gust,0,'--')} km/h.`;
    setAlert(worst.risk.score >= 3 ? 'danger' : 'warn', worst.risk.emoji, worst.risk.score >= 3 ? 'Point météo défavorable sur le parcours' : 'Un passage est à surveiller', text);
  }


  // ---------- Parcours autour d’un point (OpenStreetMap / Overpass) ----------

  function getFinderProfile(key = state.hikeFinder.profile) {
    return FINDER_PROFILES[key] || FINDER_PROFILES.hike;
  }

  function startHikeFinder() {
    if (state.planner.active) stopPlanner(true);
    state.activity.targetSelect = false;
    state.hikeFinder.active = true;
    ui.finderMapDetail?.classList.add('hidden');
    ui.hikeFinderPanel.classList.remove('hidden');
    ui.hikeFinderListBtn.classList.toggle('hidden', !state.hikeFinder.results.length);
    const profile = getFinderProfile();
    ui.hikeFinderStatus.textContent = state.hikeFinder.results.length
      ? `${state.hikeFinder.results.length} parcours ${profile.label.toLowerCase()} trouvé(s). Touchez la carte pour rechercher ailleurs.`
      : `Mode ${profile.icon} ${profile.label} · touchez la carte pour choisir le centre de recherche.`;
    showAppScreen('map', { scroll: false });
    setTimeout(() => enterMapFullscreen(), 60);
  }

  function stopHikeFinder(clearMap = true) {
    state.hikeFinder.active = false;
    state.hikeFinder.detailSerial++;
    ui.hikeFinderPanel.classList.add('hidden');
    ui.finderMapDetail?.classList.add('hidden');
    if (clearMap) clearHikeFinderMapLayers();
  }

  function clearHikeFinderMapLayers() {
    if (state.hikeFinder.centerMarker) state.map.removeLayer(state.hikeFinder.centerMarker);
    if (state.hikeFinder.resultLayer) state.map.removeLayer(state.hikeFinder.resultLayer);
    if (state.hikeFinder.previewLayer) state.map.removeLayer(state.hikeFinder.previewLayer);
    state.hikeFinder.centerMarker = null;
    state.hikeFinder.resultLayer = null;
    state.hikeFinder.previewLayer = null;
    state.hikeFinder.mapLines = [];
    state.hikeFinder.selectedIndex = -1;
    if (state.elevationHoverMarker) {
      state.map.removeLayer(state.elevationHoverMarker);
      state.elevationHoverMarker = null;
    }
  }

  function setHikeFinderCenter(point) {
    state.hikeFinder.center = { lat: Number(point.lat), lon: Number(point.lon) };
    if (state.hikeFinder.centerMarker) state.map.removeLayer(state.hikeFinder.centerMarker);
    const profile = getFinderProfile();
    const icon = L.divIcon({
      className: '',
      html: `<div class="hike-search-center">${profile.icon}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    state.hikeFinder.centerMarker = L.marker([point.lat, point.lon], { icon, zIndexOffset: 1200 }).addTo(state.map);
  }

  async function useGpsForHikeFinder() {
    let point = state.location ? { lat: state.location.lat, lon: state.location.lon } : null;
    if (!point && 'geolocation' in navigator) {
      ui.hikeFinderStatus.textContent = 'Recherche de ta position GPS…';
      try {
        const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, maximumAge: 5000, timeout: 12000
        }));
        point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch (_) {
        toast('Position GPS indisponible. Touchez directement un point sur la carte.');
        ui.hikeFinderStatus.textContent = 'Touchez la carte pour choisir le centre de recherche.';
        return;
      }
    }
    if (point) {
      state.map.setView([point.lat, point.lon], Math.max(state.map.getZoom(), 13));
      await searchHikesAround(point);
    }
  }

  async function fetchOverpass(query, timeoutMs = 42000) {
    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = new URLSearchParams({ data: query });
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
          cache: 'no-store',
          signal: controller.signal
        });
        if (res.status === 429) throw new Error('Serveur OpenStreetMap occupé (429)');
        if (!res.ok) throw new Error(`Serveur OpenStreetMap ${res.status}`);
        const data = await res.json();
        if (!data || !Array.isArray(data.elements)) throw new Error('Réponse OpenStreetMap invalide');
        return data;
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError?.name === 'AbortError') throw new Error('Le serveur de tracés met trop de temps à répondre. Réessaie dans quelques secondes.');
    if (/Failed to fetch/i.test(lastError?.message || '')) throw new Error('Impossible de joindre le serveur de tracés. Vérifie la connexion puis réessaie.');
    throw lastError || new Error('Service de recherche indisponible');
  }

  function networkLabel(network) {
    return ({ iwn: 'International', nwn: 'National', rwn: 'Régional', lwn: 'Local', icn: 'International', ncn: 'National', rcn: 'Régional', lcn: 'Local' })[network] || '';
  }

  function distanceTagText(tags = {}) {
    const raw = String(tags.distance || '').trim();
    if (!raw) return '';
    return raw.match(/[a-zA-Z]/) ? raw : `${raw} km`;
  }

  const PAVED_SURFACES = new Set(['asphalt','paved','concrete','concrete:plates','concrete:lanes','paving_stones','sett']);
  const GRAVEL_SURFACES = new Set(['gravel','fine_gravel','compacted','unpaved','ground','dirt','earth','pebblestone','woodchips','sand','rock']);
  const ROAD_HIGHWAYS = new Set(['primary','secondary','tertiary','unclassified','residential','service','living_street','cycleway','road']);
  const TRAIL_HIGHWAYS = new Set(['track','path','bridleway','footway','steps']);

  function relationSegmentsFromElement(rel, wayMap = null) {
    return (rel.members || [])
      .filter(m => m.type === 'way')
      .map(m => {
        const way = wayMap?.get(Number(m.ref));
        const geometry = (way && Array.isArray(way.geometry)) ? way.geometry : m.geometry;
        return Array.isArray(geometry) ? geometry
          .map(g => ({ lat: Number(g.lat), lon: Number(g.lon), ele: null }))
          .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
      })
      .filter(seg => seg.length > 1);
  }

  function routeWayMetrics(rel, wayMap) {
    let totalKm = 0, pavedKm = 0, roughKm = 0, technicalKm = 0, roadBadKm = 0, taggedKm = 0;
    let surfaceRoadKm = 0, surfaceGravelKm = 0, surfaceTrailKm = 0, surfaceUnknownKm = 0;
    for (const m of rel.members || []) {
      if (m.type !== 'way') continue;
      const way = wayMap.get(Number(m.ref));
      if (!way?.geometry?.length) continue;
      const seg = way.geometry.map(g => ({ lat: Number(g.lat), lon: Number(g.lon) }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (seg.length < 2) continue;
      const km = routeDistance(seg);
      totalKm += km;
      const tags = way.tags || {};
      const surface = String(tags.surface || '').toLowerCase();
      const highway = String(tags.highway || '').toLowerCase();
      const mtbScale = tags['mtb:scale'];
      const paved = PAVED_SURFACES.has(surface);
      const gravel = GRAVEL_SURFACES.has(surface);
      const trail = TRAIL_HIGHWAYS.has(highway);
      const road = ROAD_HIGHWAYS.has(highway);
      const technical = mtbScale != null || highway === 'bridleway' || (highway === 'path' && !paved) || highway === 'steps';
      if (surface || highway) taggedKm += km;
      if (paved || (road && !gravel)) pavedKm += km;
      if (gravel || highway === 'track') roughKm += km;
      if (technical) technicalKm += km;
      if (highway === 'steps' || (trail && !paved)) roadBadKm += km;
      else if (gravel && !paved) roadBadKm += km;

      // Répartition exclusive utilisée dans la fiche parcours.
      if (paved || (road && !gravel && !trail)) surfaceRoadKm += km;
      else if (technical || (trail && !gravel)) surfaceTrailKm += km;
      else if (gravel || highway === 'track') surfaceGravelKm += km;
      else surfaceUnknownKm += km;
    }
    const den = Math.max(totalKm, 0.001);
    return {
      totalKm,
      pavedRatio: pavedKm / den,
      roughRatio: roughKm / den,
      technicalRatio: technicalKm / den,
      roadBadRatio: roadBadKm / den,
      taggedRatio: taggedKm / den,
      surfaceBreakdown: {
        road: surfaceRoadKm / den,
        gravel: surfaceGravelKm / den,
        trail: surfaceTrailKm / den,
        unknown: surfaceUnknownKm / den
      }
    };
  }

  function profileAcceptsRelation(profileKey, rel, metrics) {
    const routeType = String(rel.tags?.route || '').toLowerCase();
    if (profileKey === 'hike') return routeType === 'hiking' || routeType === 'foot';
    if (profileKey === 'road') {
      if (routeType !== 'bicycle') return false;
      // Vélo route : on élimine les relations comportant une part significative
      // de chemins/surfaces non revêtues. Les voies cyclables revêtues restent acceptées.
      return metrics.roadBadRatio <= 0.08 && metrics.technicalRatio <= 0.05;
    }
    if (profileKey === 'gravel') {
      if (routeType !== 'bicycle') return false;
      // Gravel : routes + pistes roulantes, mais on évite les parcours franchement techniques.
      return metrics.technicalRatio <= 0.30;
    }
    if (profileKey === 'mtb') {
      if (routeType === 'mtb') return true;
      if (routeType !== 'bicycle') return false;
      return metrics.technicalRatio >= 0.08 || metrics.roughRatio >= 0.18;
    }
    return true;
  }

  function profileQualityText(profileKey, metrics) {
    const pct = v => `${Math.round(Math.max(0, Math.min(1, v)) * 100)} %`;
    if (profileKey === 'road') return `revêtu/route ${pct(1 - metrics.roadBadRatio)}`;
    if (profileKey === 'gravel') return metrics.roughRatio > .08 ? `chemins/pistes ${pct(metrics.roughRatio)}` : 'parcours cyclable mixte';
    if (profileKey === 'mtb') return `tout-terrain ${pct(Math.max(metrics.roughRatio, metrics.technicalRatio))}`;
    return '';
  }

  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  function formatDurationHours(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return '—';
    const totalMin = Math.max(1, Math.round(hours * 60));
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    if (!h) return `${m} min`;
    return m ? `${h} h ${String(m).padStart(2,'0')}` : `${h} h`;
  }

  function profileKeyForRoute(route, fallback = 'hike') {
    if (route?.plannerProfile && ACTIVITY_PROFILES[route.plannerProfile]) return route.plannerProfile;
    if (route?.transportMode === 'bike') return 'road';
    if (route?.transportMode === 'hike') return 'hike';
    return ACTIVITY_PROFILES[fallback] ? fallback : 'hike';
  }

  function estimateRouteDuration(route, profileKey, metrics = null) {
    const distance = Math.max(0, Number(route?.distanceKm) || 0);
    const gain = Math.max(0, Number(route?.gain) || 0);
    const rough = clamp01(metrics?.roughRatio);
    const technical = clamp01(metrics?.technicalRatio);
    let speed = 4, climbDivisor = 600, terrainFactor = 1;
    if (profileKey === 'road') { speed = 22; climbDivisor = 1000; terrainFactor = 1 + rough * .18 + technical * .25; }
    else if (profileKey === 'gravel') { speed = 17; climbDivisor = 850; terrainFactor = 1 + rough * .20 + technical * .35; }
    else if (profileKey === 'mtb') { speed = 12; climbDivisor = 700; terrainFactor = 1 + rough * .12 + technical * .45; }
    else { speed = 4; climbDivisor = 600; terrainFactor = 1 + technical * .12; }
    return (distance / speed) * terrainFactor + gain / climbDivisor;
  }

  function routeDifficulty(route, profileKey, metrics = null) {
    const d = Math.max(0, Number(route?.distanceKm) || 0);
    const g = Math.max(0, Number(route?.gain) || 0);
    const rough = clamp01(metrics?.roughRatio);
    const tech = clamp01(metrics?.technicalRatio);
    let score;
    if (profileKey === 'road') score = d / 40 + g / 800 + rough * .8 + tech * 1.4;
    else if (profileKey === 'gravel') score = d / 30 + g / 700 + rough * .8 + tech * 1.5;
    else if (profileKey === 'mtb') score = d / 22 + g / 600 + rough * .6 + tech * 2.0;
    else score = d / 8 + g / 400 + tech * .6;
    if (score < 1.45) return { label: 'Facile', icon: '🟢', cls: 'easy', score };
    if (score < 3.0) return { label: 'Modérée', icon: '🟡', cls: 'moderate', score };
    if (score < 4.8) return { label: 'Difficile', icon: '🟠', cls: 'hard', score };
    return { label: 'Très difficile', icon: '🔴', cls: 'very-hard', score };
  }

  function surfaceBreakdown(metrics) {
    const b = metrics?.surfaceBreakdown;
    if (!b) return null;
    const raw = {
      road: clamp01(b.road), gravel: clamp01(b.gravel), trail: clamp01(b.trail), unknown: clamp01(b.unknown)
    };
    const sum = raw.road + raw.gravel + raw.trail + raw.unknown;
    if (sum <= 0.001) return null;
    return Object.fromEntries(Object.entries(raw).map(([k,v]) => [k, v / sum]));
  }

  function terrainSummary(profileKey, metrics) {
    const b = surfaceBreakdown(metrics);
    if (!b) return profileKey === 'road' ? 'Route' : profileKey === 'gravel' ? 'Mixte' : profileKey === 'mtb' ? 'Tout-terrain' : 'Sentiers';
    const labels = { road: 'Route', gravel: 'Piste/gravel', trail: 'Sentier', unknown: 'Inconnu' };
    const best = Object.entries(b).sort((a,b2) => b2[1] - a[1])[0];
    return `${labels[best[0]]} ${Math.round(best[1] * 100)} %`;
  }

  function surfaceBreakdownHtml(metrics) {
    const b = surfaceBreakdown(metrics);
    if (!b) return '<div class="surface-unavailable">Surface détaillée non renseignée dans OpenStreetMap.</div>';
    const items = [
      ['road','Route / revêtu','surface-road'],
      ['gravel','Piste / gravel','surface-gravel'],
      ['trail','Sentier','surface-trail'],
      ['unknown','Inconnu','surface-unknown']
    ].filter(([key]) => b[key] >= .015);
    return `<div class="surface-breakdown">${items.map(([key,label,cls]) => `
      <div class="surface-row"><span>${label}</span><div class="surface-bar"><i class="${cls}" style="width:${Math.round(b[key]*100)}%"></i></div><strong>${Math.round(b[key]*100)} %</strong></div>`).join('')}</div>`;
  }

  async function elevatedRouteCopy(route, maxPoints = 240) {
    const originalPoints = route.points || [];
    let points = resampleRouteByDistance(originalPoints, maxPoints);
    if (points.length < 2) throw new Error('Tracé insuffisant pour calculer le profil.');
    const known = points.filter(p => hasElevation(p.ele)).length;
    if (known / points.length < .9) {
      if (!navigator.onLine) {
        const offline = buildRouteObject(route.name, points, { ...route });
        offline.distanceKm = routeDistance(originalPoints);
        return offline;
      }
      points = await addElevations(points);
    }
    const { points: _points, distanceKm: _distanceKm, gain: _gain, loss: _loss, high: _high, low: _low, rawGain: _rawGain, rawLoss: _rawLoss, elevationProfile: _ep, ...meta } = route;
    const elevated = buildRouteObject(route.name, points, meta);
    // La distance reste calculée sur la géométrie complète, jamais sur la copie
    // simplifiée destinée au relief.
    elevated.distanceKm = routeDistance(originalPoints);
    return elevated;
  }

  function buildElevationChartHtml(route, chartKey, progressRatio = null) {
    const allPoints = (route?.elevationProfile?.length ? route.elevationProfile : route?.points) || [];
    const pts = allPoints.filter(p => hasElevation(p.ele));
    if (pts.length < 2 || pts.length / Math.max(1, allPoints.length) < .7) return '<div class="elevation-unavailable">Profil altimétrique indisponible pour ce tracé.</div>';
    // Si le profil vient de notre rééchantillonnage, distKm contient la
    // distance réelle le long du tracé complet. On l'utilise pour l'axe X
    // afin que le profil affiche exactement la même distance que le parcours.
    const explicitDistances = pts.map(p => Number(p.distKm));
    const hasExplicitDistances = explicitDistances.length > 1 && explicitDistances.every((d, i) => Number.isFinite(d) && d >= 0 && (i === 0 || d >= explicitDistances[i - 1]));
    const cumulative = hasExplicitDistances ? explicitDistances : buildCumulativeRouteKm(pts);
    const routeTotal = Number(route.distanceKm);
    const total = Number.isFinite(routeTotal) && routeTotal > 0 ? routeTotal : (cumulative[cumulative.length - 1] || 1);
    const elevations = pts.map(p => Number(p.ele));
    let min = Math.min(...elevations), max = Math.max(...elevations);
    if (max - min < 20) { max += 10; min -= 10; }
    const W = 600, H = 178, left = 18, right = 18, top = 12, bottom = 32;
    const innerW = W - left - right, innerH = H - top - bottom;
    const xy = pts.map((p,i) => ({
      x: left + (cumulative[i] / Math.max(total,.001)) * innerW,
      y: top + (1 - (Number(p.ele) - min) / Math.max(1,max-min)) * innerH
    }));
    const linePath = xy.map((q,i) => `${i?'L':'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${xy[xy.length-1].x.toFixed(1)},${(top+innerH).toFixed(1)} L${xy[0].x.toFixed(1)},${(top+innerH).toFixed(1)} Z`;
    state.elevationCharts.set(chartKey, { route, points: pts, cumulative, total, xy, W, left, innerW });
    const pr = Number.isFinite(progressRatio) ? clamp01(progressRatio) : null;
    const px = pr == null ? left : left + pr * innerW;
    let liveBest = 0;
    if (pr != null) {
      const targetKm = pr * total;
      let liveDiff = Infinity;
      for (let i=0;i<cumulative.length;i++) { const d=Math.abs(cumulative[i]-targetKm); if(d<liveDiff){liveDiff=d;liveBest=i;} }
    }
    const liveQ = xy[liveBest] || xy[0];
    const rawGain = Number(route?.rawGain), filteredGain = Number(route?.gain);
    const filterDiagnostic = Number.isFinite(rawGain) && Number.isFinite(filteredGain) && rawGain > filteredGain + 20
      ? `D+ brut ${Math.round(rawGain)} m → lissé ${Math.round(filteredGain)} m`
      : 'Profil lissé · micro-variations altimétriques ignorées';
    return `<div class="elevation-chart" data-elevation-chart="${escapeHtml(chartKey)}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Profil altimétrique interactif">
        <line class="elev-grid" x1="${left}" y1="${top}" x2="${W-right}" y2="${top}" />
        <line class="elev-grid" x1="${left}" y1="${top+innerH}" x2="${W-right}" y2="${top+innerH}" />
        <path class="elev-area" d="${areaPath}" />
        <path class="elev-line" d="${linePath}" />
        <line class="elev-progress ${pr==null?'hidden':''}" data-elev-progress x1="${px}" y1="${top}" x2="${px}" y2="${top+innerH}" />
        <circle class="elev-live-dot ${pr==null?'hidden':''}" data-elev-live-dot cx="${liveQ.x}" cy="${liveQ.y}" r="6" />
        <line class="elev-cursor" data-elev-cursor x1="${left}" y1="${top}" x2="${left}" y2="${top+innerH}" />
        <circle class="elev-dot" data-elev-dot cx="${xy[0].x}" cy="${xy[0].y}" r="5" />
        <text class="elev-axis-label" x="${left}" y="${H-7}">0 km</text>
        <text class="elev-axis-label" text-anchor="end" x="${W-right}" y="${H-7}">${total.toFixed(1).replace('.',',')} km</text>
        <text class="elev-alt-label" x="${left+4}" y="${top+12}">${Math.round(max)} m</text>
        <text class="elev-alt-label" x="${left+4}" y="${top+innerH-5}">${Math.round(min)} m</text>
      </svg>
      <div class="elevation-readout"><span>Distance <strong data-elev-distance>0,0 km</strong></span><span>Altitude <strong data-elev-altitude>${Math.round(elevations[0])} m</strong></span><span class="elevation-readout-hint">↔ Glisser</span></div>
      <div class="elevation-filter-note">${filterDiagnostic} pour le calcul D+/D−</div>
    </div>`;
  }

  function bindElevationCharts(root = document) {
    root.querySelectorAll?.('.elevation-chart:not([data-elev-bound])').forEach(chart => {
      chart.dataset.elevBound = '1';
      const svg = chart.querySelector('svg');
      if (!svg) return;
      const update = ev => {
        const data = state.elevationCharts.get(chart.dataset.elevationChart);
        if (!data) return;
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = clamp01((ev.clientX - rect.left) / rect.width);
        const targetKm = ratio * data.total;
        let best = 0, diff = Infinity;
        for (let i=0;i<data.cumulative.length;i++) {
          const d = Math.abs(data.cumulative[i] - targetKm);
          if (d < diff) { diff = d; best = i; }
        }
        const q = data.xy[best], point = data.points[best];
        const cursor = chart.querySelector('[data-elev-cursor]');
        const dot = chart.querySelector('[data-elev-dot]');
        cursor?.setAttribute('x1', q.x); cursor?.setAttribute('x2', q.x);
        dot?.setAttribute('cx', q.x); dot?.setAttribute('cy', q.y);
        const dist = chart.querySelector('[data-elev-distance]');
        const alt = chart.querySelector('[data-elev-altitude]');
        if (dist) dist.textContent = `${data.cumulative[best].toFixed(1).replace('.',',')} km`;
        if (alt) alt.textContent = `${Math.round(Number(point.ele))} m`;
        chart.dataset.manualUntil = String(Date.now() + 3000);
        showElevationPointOnMap(point);
      };
      const restoreLive = () => {
        setTimeout(() => {
          if (Date.now() < Number(chart.dataset.manualUntil || 0)) return;
          const r = Number(chart.dataset.liveRatio);
          if (Number.isFinite(r)) updateElevationChartProgress(chart.dataset.elevationChart, r);
        }, 3100);
      };
      svg.addEventListener('pointerdown', ev => { try { svg.setPointerCapture(ev.pointerId); } catch (_) {} update(ev); });
      svg.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse' || svg.hasPointerCapture?.(ev.pointerId)) update(ev); });
      svg.addEventListener('pointerup', restoreLive);
      svg.addEventListener('pointercancel', restoreLive);
    });
  }

  function redMapPointIcon() {
    return L.divIcon({
      className: 'rr-red-map-point-wrap',
      html: '<span class="rr-red-map-point"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function showElevationPointOnMap(point) {
    if (!state.map || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
    const ll = [Number(point.lat), Number(point.lon)];
    // Important avec leaflet-rotate : un vrai L.marker est recalculé par le plugin
    // comme le point GPS bleu. Un circleMarker SVG/Canvas placé dans markerPane
    // pouvait rester visuellement décalé quand la carte était tournée.
    if (!state.elevationHoverMarker) {
      state.elevationHoverMarker = L.marker(ll, { icon: redMapPointIcon(), zIndexOffset: 1200, interactive: false }).addTo(state.map);
    } else state.elevationHoverMarker.setLatLng(ll);
    state.elevationHoverMarker.bindTooltip(`${Math.round(Number(point.ele) || 0)} m`, { direction:'top', offset:[0,-10] }).openTooltip();
  }

  function updateElevationChartProgress(chartKey, ratio) {
    const chart = document.querySelector(`.elevation-chart[data-elevation-chart="${chartKey}"]`);
    const data = state.elevationCharts.get(chartKey);
    if (!chart || !data) return;
    const r = clamp01(ratio);
    chart.dataset.liveRatio = String(r);
    const line = chart.querySelector('[data-elev-progress]');
    const x = data.left + r * data.innerW;
    if (line) {
      line.classList.remove('hidden');
      line.setAttribute('x1', x); line.setAttribute('x2', x);
    }
    const targetKm = r * data.total;
    let best = 0, diff = Infinity;
    for (let i=0;i<data.cumulative.length;i++) { const d=Math.abs(data.cumulative[i]-targetKm); if(d<diff){diff=d;best=i;} }
    const q = data.xy[best], point = data.points[best];
    const liveDot = chart.querySelector('[data-elev-live-dot]');
    if (liveDot && q) {
      liveDot.classList.remove('hidden');
      liveDot.setAttribute('cx', q.x); liveDot.setAttribute('cy', q.y);
    }
    // Après 3 s sans manipulation manuelle, le curseur et les valeurs reviennent
    // automatiquement sur la progression réelle.
    if (Date.now() >= Number(chart.dataset.manualUntil || 0) && q && point) {
      const cursor = chart.querySelector('[data-elev-cursor]');
      const dot = chart.querySelector('[data-elev-dot]');
      cursor?.setAttribute('x1', q.x); cursor?.setAttribute('x2', q.x);
      dot?.setAttribute('cx', q.x); dot?.setAttribute('cy', q.y);
      const dist = chart.querySelector('[data-elev-distance]');
      const alt = chart.querySelector('[data-elev-altitude]');
      if (dist) dist.textContent = `${data.cumulative[best].toFixed(1).replace('.',',')} km`;
      if (alt) alt.textContent = `${Math.round(Number(point.ele))} m`;
    }
  }

  function routeDetails(route, profileKey, metrics = null) {
    const durationHours = estimateRouteDuration(route, profileKey, metrics);
    const difficulty = routeDifficulty(route, profileKey, metrics);
    return { route, profileKey, metrics, durationHours, difficulty, terrain: terrainSummary(profileKey, metrics) };
  }

  function detailStatsHtml(detail) {
    const r = detail.route, p = ACTIVITY_PROFILES[detail.profileKey] || ACTIVITY_PROFILES.hike;
    return `<div class="finder-detail-profile"><span>${p.icon}</span><strong>${escapeHtml(p.label)}</strong></div>
      <div class="finder-detail-stats">
        <div><span>Distance</span><strong>${Number(r.distanceKm||0).toFixed(1).replace('.',',')} km</strong></div>
        <div><span>Temps estimé</span><strong>${formatDurationHours(detail.durationHours)}</strong></div>
        <div><span>D+</span><strong>${r.high==null?'—':`+${Math.round(r.gain)} m`}</strong></div>
        <div><span>D−</span><strong>${r.high==null?'—':`−${Math.round(r.loss)} m`}</strong></div>
        <div><span>Altitude min.</span><strong>${r.low==null?'—':`${Math.round(r.low)} m`}</strong></div>
        <div><span>Altitude max.</span><strong>${r.high==null?'—':`${Math.round(r.high)} m`}</strong></div>
      </div>
      <div class="difficulty-pill ${detail.difficulty.cls}">${detail.difficulty.icon} Difficulté : <strong>${detail.difficulty.label}</strong></div>`;
  }

  function finderDetailHtml(detail, chartKey) {
    return `${detailStatsHtml(detail)}
      <div class="finder-surface-block"><div class="finder-subtitle">Terrain estimé</div>${surfaceBreakdownHtml(detail.metrics)}</div>
      <div class="finder-elevation-block"><div class="finder-subtitle">Profil altimétrique interactif</div>${buildElevationChartHtml(detail.route, chartKey)}</div>
      <p class="finder-detail-note">Temps et difficulté sont des estimations calculées à partir de la distance, ${detail.reliefAvailable === false ? 'du terrain disponible (relief indisponible pour le moment)' : 'du dénivelé'} et du type de terrain disponible dans OpenStreetMap.</p>`;
  }

  async function ensureFinderDetails(result) {
    if (result.detailData?.route) return result.detailData;
    if (result.detailPromise) return result.detailPromise;
    result.detailPromise = (async () => {
      await ensureHikeGeometry(result);
      const profileKey = result.profile || state.hikeFinder.profile || 'hike';
      const base = buildRouteObject(result.name, (result.points.length > 3000 ? resampleRouteByDistance(result.points, 3000) : result.points.map(p => ({...p}))), {
        source:`osm-${profileKey}`, transportMode:getFinderProfile(profileKey).transportMode, plannerProfile:profileKey,
        osmRelationId:result.id, osmRef:result.ref||'', osmNetwork:result.network||'', metrics:result.metrics
      });
      let elevated = base;
      try { elevated = await elevatedRouteCopy(base, 240); } catch (_) { /* fiche utilisable même sans service d'altitude */ }
      const detail = routeDetails(elevated, profileKey, result.metrics);
      detail.reliefAvailable = elevated.high != null;
      result.detailRoute = elevated;
      result.detailData = detail;
      result.distanceKm = elevated.distanceKm;
      return detail;
    })();
    try { return await result.detailPromise; }
    finally { result.detailPromise = null; }
  }

  function setFinderDetailLoading(result, source) {
    const p = getFinderProfile(result.profile || state.hikeFinder.profile);
    // Un ancien point rouge du profil ne doit jamais rester affiché quand on
    // sélectionne un autre parcours. Avec la carte rotative, un marker placé
    // dans markerPane pouvait aussi sembler décalé par rapport au tracé.
    if (state.elevationHoverMarker) {
      try { state.map?.removeLayer(state.elevationHoverMarker); } catch (_) {}
      state.elevationHoverMarker = null;
    }
    const loading = '<div class="finder-detail-loading"><span class="finder-detail-spinner">↻</span><strong>Calcul du relief…</strong><small>Distance, dénivelé, difficulté et profil altimétrique.</small></div>';
    if (source === 'map') {
      ui.finderMapDetailType.textContent = `${p.icon} ${p.label}`;
      ui.finderMapDetailName.textContent = result.name;
      ui.finderMapDetailBody.innerHTML = loading;
      ui.finderMapDetail.classList.remove('hidden');
      setFinderMapDetailCollapsed(false);
      ui.hikeFinderPanel.classList.add('hidden');
    } else {
      ui.finderDetailType.textContent = `${p.icon} ${p.label}`;
      ui.finderDetailName.textContent = result.name;
      ui.finderDetailBody.innerHTML = loading;
      ui.finderDetailCard.classList.remove('hidden');
    }
  }

  async function openFinderDetails(index, source = 'routes') {
    const result = state.hikeFinder.results[index];
    if (!result) return;
    state.hikeFinder.detailSource = source;
    const serial = ++state.hikeFinder.detailSerial;
    setFinderDetailLoading(result, source);
    try {
      const detail = await ensureFinderDetails(result);
      if (serial !== state.hikeFinder.detailSerial || state.hikeFinder.selectedIndex !== index) return;
      const p = getFinderProfile(detail.profileKey);
      ui.finderMapDetailType.textContent = `${p.icon} ${p.label}`;
      ui.finderMapDetailName.textContent = result.name;
      ui.finderDetailType.textContent = `${p.icon} ${p.label}`;
      ui.finderDetailName.textContent = result.name;
      ui.finderMapDetailBody.innerHTML = finderDetailHtml(detail, `finder-map-${result.id}`);
      ui.finderDetailBody.innerHTML = finderDetailHtml(detail, `finder-card-${result.id}`);
      if (source === 'routes') ui.finderDetailCard.classList.remove('hidden');
      bindElevationCharts(ui.finderMapDetail);
      bindElevationCharts(ui.finderDetailCard);
    } catch (err) {
      const msg = `<div class="finder-detail-error">⚠️ ${escapeHtml(err?.message || 'Impossible de calculer les détails de ce parcours.')}</div>`;
      ui.finderMapDetailBody.innerHTML = msg;
      ui.finderDetailBody.innerHTML = msg;
    }
  }

  function setFinderMapDetailCollapsed(collapsed) {
    if (!ui.finderMapDetail) return;
    ui.finderMapDetail.classList.toggle('collapsed', !!collapsed);
    if (ui.finderMapDetailToggle) {
      ui.finderMapDetailToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      ui.finderMapDetailToggle.setAttribute('aria-label', collapsed ? 'Agrandir les détails du parcours' : 'Réduire les détails du parcours');
    }
    if (!collapsed) ui.finderMapDetail.scrollTop = 0;
  }

  function closeFinderMapDetail() {
    ui.finderMapDetail?.classList.add('hidden');
    ui.finderMapDetail?.classList.remove('collapsed');
    if (state.hikeFinder.active) ui.hikeFinderPanel?.classList.remove('hidden');
  }

  function bindFinderMapDetailSheet() {
    const panel = ui.finderMapDetail;
    if (!panel || panel.dataset.sheetBound === '1') return;
    panel.dataset.sheetBound = '1';

    const resetDragVisual = () => {
      panel.classList.remove('sheet-dragging');
      panel.style.removeProperty('--sheet-drag-y');
    };

    const applySwipe = (dy, dx = 0) => {
      if (!Number.isFinite(dy) || Math.abs(dy) < 42 || Math.abs(dy) < Math.abs(dx) * 1.15) return false;
      if (dy > 0) {
        if (panel.classList.contains('collapsed')) closeFinderMapDetail();
        else setFinderMapDetailCollapsed(true);
      } else {
        setFinderMapDetailCollapsed(false);
      }
      return true;
    };

    ui.finderMapDetailToggle?.addEventListener('click', e => {
      e.stopPropagation();
      setFinderMapDetailCollapsed(!panel.classList.contains('collapsed'));
    });

    // Sur Android/WebView, un glissement vertical peut être transformé en scroll
    // et provoquer pointercancel avant pointerup. La poignée et l'en-tête utilisent
    // donc une capture de pointeur explicite, tandis qu'un fallback touchstart/end
    // couvre aussi le geste fait depuis le haut du contenu.
    let pointerId = null, startY = 0, startX = 0, lastY = 0, lastX = 0;
    let suppressTouchUntil = 0;
    const pointerStart = e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button:not(.finder-detail-sheet-toggle),input,a,.elevation-chart')) return;
      const gripArea = !!e.target.closest('.finder-detail-sheet-toggle,.finder-detail-head');
      if (!gripArea && !panel.classList.contains('collapsed') && panel.scrollTop > 2) return;
      pointerId = e.pointerId;
      startY = lastY = e.clientY;
      startX = lastX = e.clientX;
      panel.classList.add('sheet-dragging');
      try { panel.setPointerCapture(pointerId); } catch (_) {}
    };
    const pointerMove = e => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      lastY = e.clientY; lastX = e.clientX;
      const dy = lastY - startY;
      if (Math.abs(dy) > 4) {
        // Retour visuel : la fiche suit légèrement le doigt sans modifier sa
        // position finale tant que le seuil de réduction n'est pas franchi.
        const visualY = Math.max(-36, Math.min(150, dy * 0.72));
        panel.style.setProperty('--sheet-drag-y', `${visualY}px`);
        if (e.cancelable) e.preventDefault();
      }
    };
    const pointerFinish = e => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      const dy = (Number.isFinite(e.clientY) ? e.clientY : lastY) - startY;
      const dx = (Number.isFinite(e.clientX) ? e.clientX : lastX) - startX;
      try { panel.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
      resetDragVisual();
      suppressTouchUntil = Date.now() + 650;
      applySwipe(dy, dx);
    };
    panel.addEventListener('pointerdown', pointerStart);
    panel.addEventListener('pointermove', pointerMove, { passive:false });
    panel.addEventListener('pointerup', pointerFinish);
    panel.addEventListener('pointercancel', e => {
      // Si Android annule le pointeur à cause d'un scroll, le fallback tactile
      // ci-dessous décidera du geste au touchend.
      if (pointerId != null && e.pointerId === pointerId) {
        pointerId = null;
        resetDragVisual();
      }
    });

    let touchStartY = null, touchStartX = null;
    panel.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('button:not(.finder-detail-sheet-toggle),input,a,.elevation-chart')) return;
      const gripArea = !!e.target.closest('.finder-detail-sheet-toggle,.finder-detail-head');
      if (!gripArea && !panel.classList.contains('collapsed') && panel.scrollTop > 2) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    }, { passive:true });
    panel.addEventListener('touchend', e => {
      if (touchStartY == null) return;
      if (Date.now() < suppressTouchUntil) { touchStartY = touchStartX = null; return; }
      const t = e.changedTouches?.[0];
      const dy = t ? t.clientY - touchStartY : 0;
      const dx = t ? t.clientX - touchStartX : 0;
      touchStartY = touchStartX = null;
      if (pointerId == null) applySwipe(dy, dx);
    }, { passive:true });
    panel.addEventListener('touchcancel', () => { touchStartY = touchStartX = null; }, { passive:true });
  }

  function closeFinderDetailCard() { ui.finderDetailCard?.classList.add('hidden'); }

  async function renderLoadedRouteDetails(route) {
    const serial = ++state.routeDetailSerial;
    const profileKey = profileKeyForRoute(route, route?.plannerProfile || 'hike');
    const baseDifficulty = routeDifficulty(route, profileKey, route?.metrics || null);
    ui.routeDuration.textContent = formatDurationHours(estimateRouteDuration(route, profileKey, route?.metrics || null));
    ui.routeDifficulty.textContent = `${baseDifficulty.icon} ${baseDifficulty.label}`;
    ui.routeLow.textContent = route.low == null ? '—' : `${Math.round(route.low)} m`;
    ui.routeSurface.textContent = terrainSummary(profileKey, route?.metrics || null);
    ui.routeElevationSection.classList.add('hidden');
    ui.routeElevationChart.innerHTML = '<div class="finder-detail-loading compact"><span class="finder-detail-spinner">↻</span><small>Calcul du profil altimétrique…</small></div>';
    try {
      const elevated = await elevatedRouteCopy(route, 240);
      if (serial !== state.routeDetailSerial || state.route !== route) return;
      // On enrichit aussi le parcours courant afin que les stats D+/D− deviennent disponibles pour un GPX sans altitude.
      if (elevated.high != null) {
        route.gain = elevated.gain; route.loss = elevated.loss; route.high = elevated.high; route.low = elevated.low;
        route.rawGain = elevated.rawGain; route.rawLoss = elevated.rawLoss;
        route.elevationProfile = elevated.elevationProfile || elevated.points;
        route.elevationFiltered = true;
        // La distance est toujours recalculée sur le tracé complet.
        route.distanceKm = routeDistance(route.points || []);
        ui.routeDistance.textContent = `${route.distanceKm.toFixed(1)} km`;
        ui.routeGain.textContent = `${Math.round(route.gain)} m`;
        ui.routeLoss.textContent = `${Math.round(route.loss)} m`;
        ui.routeHigh.textContent = `${Math.round(route.high)} m`;
      }
      const detail = routeDetails(elevated, profileKey, route?.metrics || null);
      ui.routeDuration.textContent = formatDurationHours(detail.durationHours);
      ui.routeDifficulty.textContent = `${detail.difficulty.icon} ${detail.difficulty.label}`;
      ui.routeLow.textContent = elevated.low == null ? '—' : `${Math.round(elevated.low)} m`;
      ui.routeSurface.textContent = detail.terrain;
      ui.routeElevationChart.innerHTML = buildElevationChartHtml(elevated, 'current-route');
      ui.routeElevationSection.classList.remove('hidden');
      bindElevationCharts(ui.routeElevationSection);
      if (state.activity.followRoute === route && state.activity.followRouteCumKm && state.activity.followRouteLastIndex != null) {
        const total = route.distanceKm || state.activity.followRouteCumKm.at(-1) || 1;
        const done = state.activity.followRouteCumKm[state.activity.followRouteLastIndex] || 0;
        updateElevationChartProgress('current-route', done / total);
      }
    } catch (_) {
      if (serial !== state.routeDetailSerial || state.route !== route) return;
      ui.routeElevationSection.classList.remove('hidden');
      ui.routeElevationChart.innerHTML = '<div class="elevation-unavailable">Profil altimétrique indisponible hors connexion ou pour ce tracé.</div>';
    }
  }

  function hikeResultMeta(result) {
    const parts = [];
    if (result.ref) parts.push(result.ref);
    const net = networkLabel(result.network);
    if (net) parts.push(net);
    if (result.distanceKm != null) parts.push(`${result.distanceKm.toFixed(1).replace('.', ',')} km`);
    else if (result.distanceTag) parts.push(result.distanceTag);
    if (result.profileHint) parts.push(result.profileHint);
    if (result.from && result.to) parts.push(`${result.from} → ${result.to}`);
    return parts.join(' · ') || 'Itinéraire OpenStreetMap';
  }

  function buildFinderQuery(profileKey, point, radiusM) {
    const lat = Number(point.lat).toFixed(6), lon = Number(point.lon).toFixed(6);
    let relationSelector = '';
    if (profileKey === 'hike') {
      relationSelector = `relation(around:${radiusM},${lat},${lon})["type"="route"]["route"~"^(hiking|foot)$"];`;
    } else if (profileKey === 'mtb') {
      relationSelector = `relation(around:${radiusM},${lat},${lon})["type"="route"]["route"="mtb"];relation(around:${radiusM},${lat},${lon})["type"="route"]["route"="bicycle"];`;
    } else {
      relationSelector = `relation(around:${radiusM},${lat},${lon})["type"="route"]["route"="bicycle"];`;
    }
    return `[out:json][timeout:38];(${relationSelector})->.routes;(.routes;way(r.routes););out body geom qt;`;
  }

  function parseFinderResults(data, profileKey) {
    const elements = data.elements || [];
    const ways = new Map(elements.filter(el => el.type === 'way').map(w => [Number(w.id), w]));
    const seen = new Set();
    const results = [];
    for (const rel of elements.filter(el => el.type === 'relation')) {
      if (seen.has(rel.id)) continue;
      seen.add(rel.id);
      const tags = rel.tags || {};
      const segments = relationSegmentsFromElement(rel, ways);
      if (!segments.length) continue;
      const points = stitchHikeSegments(segments);
      if (points.length < 2) continue;
      const metrics = routeWayMetrics(rel, ways);
      if (!profileAcceptsRelation(profileKey, rel, metrics)) continue;
      const distanceKm = routeDistance(points);
      results.push({
        id: Number(rel.id),
        name: tags.name || tags['name:fr'] || tags.ref || `${getFinderProfile(profileKey).label} OSM ${rel.id}`,
        ref: tags.ref || '', network: tags.network || '', operator: tags.operator || '',
        from: tags.from || '', to: tags.to || '', distanceTag: distanceTagText(tags), tags,
        center: rel.center || null, points, segments, distanceKm,
        profile: profileKey, metrics, profileHint: profileQualityText(profileKey, metrics), geometryPromise: null
      });
    }
    // Les parcours les plus proches du point choisi remontent en premier si un centre est connu,
    // puis tri par nom pour rester stable.
    const center = state.hikeFinder.center;
    return results.sort((a,b) => {
      const ac = a.center && center ? haversine({lat:center.lat,lon:center.lon},{lat:a.center.lat,lon:a.center.lon}) : 9999;
      const bc = b.center && center ? haversine({lat:center.lat,lon:center.lon},{lat:b.center.lat,lon:b.center.lon}) : 9999;
      return ac - bc || (a.name || '').localeCompare(b.name || '', 'fr');
    }).slice(0, 30);
  }

  async function searchHikesAround(point) {
    if (state.hikeFinder.loading) return;
    const lat = Number(point.lat), lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const serial = ++state.hikeFinder.requestSerial;
    state.hikeFinder.loading = true;
    state.hikeFinder.selectedIndex = -1;
    state.hikeFinder.detailSerial++;
    ui.finderMapDetail?.classList.add('hidden');
    ui.finderDetailCard?.classList.add('hidden');
    setHikeFinderCenter({ lat, lon });
    const profile = getFinderProfile();
    ui.hikeFinderStatus.textContent = `${profile.icon} Recherche ${profile.label.toLowerCase()} dans un rayon de ${state.hikeFinder.radiusKm} km…`;
    ui.hikeFinderListBtn.classList.add('hidden');
    if (ui.hikeFinderMapResults) ui.hikeFinderMapResults.innerHTML = '<div class="hike-map-loading">Recherche des tracés…</div>';

    try {
      const radiusM = Math.round(state.hikeFinder.radiusKm * 1000);
      const query = buildFinderQuery(state.hikeFinder.profile, { lat, lon }, radiusM);
      const data = await fetchOverpass(query, 46000);
      if (serial !== state.hikeFinder.requestSerial) return;

      const results = parseFinderResults(data, state.hikeFinder.profile);
      state.hikeFinder.results = results;
      renderHikeFinderResults();
      renderHikeFinderMapResults();
      drawFinderResultsOnMap(true);
      ui.hikeFinderResultsCard.classList.toggle('hidden', !results.length);
      ui.hikeFinderListBtn.classList.toggle('hidden', !results.length);
      ui.hikeFinderStatus.textContent = results.length
        ? `${results.length} parcours ${profile.label.toLowerCase()} trouvé(s) dans ${state.hikeFinder.radiusKm} km.`
        : `Aucun parcours ${profile.label.toLowerCase()} compatible trouvé dans ${state.hikeFinder.radiusKm} km.`;
    } catch (err) {
      if (serial !== state.hikeFinder.requestSerial) return;
      state.hikeFinder.results = [];
      renderHikeFinderResults();
      renderHikeFinderMapResults();
      if (state.hikeFinder.resultLayer) state.map.removeLayer(state.hikeFinder.resultLayer);
      state.hikeFinder.resultLayer = null;
      ui.hikeFinderStatus.textContent = 'Recherche indisponible pour le moment.';
      toast(err.message || 'Impossible de rechercher les parcours OpenStreetMap pour le moment.');
    } finally {
      if (serial === state.hikeFinder.requestSerial) state.hikeFinder.loading = false;
    }
  }

  function renderHikeFinderResults() {
    const list = state.hikeFinder.results;
    const profile = getFinderProfile();
    if (ui.hikeFinderResultsSummary) {
      ui.hikeFinderResultsSummary.textContent = state.hikeFinder.center
        ? `${profile.icon} ${profile.label} · ${list.length} résultat(s) · rayon ${state.hikeFinder.radiusKm} km.`
        : `${list.length} résultat(s).`;
    }
    ui.hikeFinderResultsList.innerHTML = list.map((r, i) => `
      <div class="hike-result-item ${i === state.hikeFinder.selectedIndex ? 'selected' : ''}" data-hike-index="${i}">
        <button type="button" class="hike-result-select" data-hike-select="${i}" aria-label="Sélectionner ${escapeHtml(r.name)}">
          <div class="hike-result-name">${escapeHtml(r.name)}</div>
          <div class="hike-result-meta">${escapeHtml(hikeResultMeta(r))}</div>
        </button>
        <div class="hike-result-actions">
          <button type="button" data-hike-action="show" title="Afficher sur la carte">🗺️</button>
          <button type="button" data-hike-action="save" title="Enregistrer dans Mes parcours">💾</button>
          <button type="button" class="hike-load" data-hike-action="load">Charger</button>
        </div>
      </div>`).join('');
  }

  function renderHikeFinderMapResults() {
    if (!ui.hikeFinderMapResults) return;
    const list = state.hikeFinder.results;
    if (!list.length) {
      ui.hikeFinderMapResults.innerHTML = '<div class="hike-map-empty">Aucun tracé à afficher.</div>';
      return;
    }
    ui.hikeFinderMapResults.innerHTML = list.map((r,i) => `
      <button type="button" class="hike-map-result ${i === state.hikeFinder.selectedIndex ? 'selected' : ''}" data-hike-map-index="${i}">
        <span>${getFinderProfile(r.profile).icon}</span>
        <span><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(hikeResultMeta(r))}</small></span>
      </button>`).join('');
  }

  function drawFinderResultsOnMap(fit = false) {
    if (state.hikeFinder.resultLayer) state.map.removeLayer(state.hikeFinder.resultLayer);
    state.hikeFinder.mapLines = [];
    const layers = [];
    state.hikeFinder.results.forEach((result, index) => {
      const lines = (result.segments || []).map(seg => seg.map(p => [p.lat, p.lon]));
      if (!lines.length) return;
      const selected = index === state.hikeFinder.selectedIndex;
      const line = L.polyline(lines, {
        color: selected ? '#0f8a67' : '#52677a',
        weight: selected ? 6 : 4,
        opacity: selected ? .96 : .58,
        lineCap: 'round', lineJoin: 'round'
      });
      line.bindTooltip(result.name, { sticky: true, direction: 'top' });
      line.on('click', ev => {
        if (ev?.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
        selectFinderResult(index, true);
      });
      state.hikeFinder.mapLines[index] = line;
      layers.push(line);
    });
    state.hikeFinder.resultLayer = L.featureGroup(layers).addTo(state.map);
    if (fit && layers.length) {
      const bounds = state.hikeFinder.resultLayer.getBounds();
      if (bounds.isValid()) state.map.fitBounds(bounds, { paddingTopLeft: [24, 80], paddingBottomRight: [24, 220], maxZoom: 14 });
    }
  }

  function refreshFinderLineStyles() {
    state.hikeFinder.mapLines.forEach((line, index) => {
      if (!line) return;
      const selected = index === state.hikeFinder.selectedIndex;
      line.setStyle({ color: selected ? '#0f8a67' : '#52677a', weight: selected ? 6 : 4, opacity: selected ? .96 : .48 });
      if (selected) line.bringToFront();
    });
  }

  function selectFinderResult(index, focusMap = false, openDetails = true) {
    const result = state.hikeFinder.results[index];
    if (!result) return;
    state.hikeFinder.selectedIndex = index;
    refreshFinderLineStyles();
    renderHikeFinderResults();
    renderHikeFinderMapResults();
    requestAnimationFrame(() => {
      ui.hikeFinderMapResults?.querySelector('.hike-map-result.selected')?.scrollIntoView({ block: 'nearest' });
      ui.hikeFinderResultsList?.querySelector('.hike-result-item.selected')?.scrollIntoView({ block: 'nearest' });
    });
    if (focusMap) {
      const line = state.hikeFinder.mapLines[index];
      if (line) {
        const bounds = line.getBounds();
        if (bounds.isValid()) state.map.fitBounds(bounds, { paddingTopLeft: [24, 80], paddingBottomRight: [24, 330], maxZoom: 15 });
      }
    }
    if (openDetails) openFinderDetails(index, focusMap ? 'map' : 'routes');
  }

  function stitchHikeSegments(segments) {
    const chains = [];
    const JOIN_KM = 0.25;
    for (const original of segments) {
      const seg = original.map(p => ({ ...p }));
      if (seg.length < 2) continue;
      let best = null;
      for (let ci = 0; ci < chains.length; ci++) {
        const chain = chains[ci];
        const cs = chain[0], ce = chain[chain.length - 1], ss = seg[0], se = seg[seg.length - 1];
        const candidates = [
          { d: haversine(ce, ss), where: 'append', reverse: false },
          { d: haversine(ce, se), where: 'append', reverse: true },
          { d: haversine(cs, se), where: 'prepend', reverse: false },
          { d: haversine(cs, ss), where: 'prepend', reverse: true }
        ];
        const local = candidates.sort((a,b) => a.d - b.d)[0];
        if (!best || local.d < best.d) best = { ...local, ci };
      }
      if (!best || best.d > JOIN_KM) {
        chains.push(seg);
        continue;
      }
      const chain = chains[best.ci];
      const part = best.reverse ? seg.slice().reverse() : seg;
      if (best.where === 'append') chain.push(...part.slice(1));
      else chain.unshift(...part.slice(0, -1));
    }
    if (!chains.length) return [];
    chains.sort((a,b) => routeDistance(b) - routeDistance(a));
    return chains[0];
  }

  function parseHikeGpxGeometry(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('GPX du parcours illisible');
    let segments = [...xml.querySelectorAll('trkseg')].map(seg => [...seg.querySelectorAll('trkpt')].map(n => ({
      lat: Number(n.getAttribute('lat')),
      lon: Number(n.getAttribute('lon')),
      ele: n.querySelector('ele') ? Number(n.querySelector('ele').textContent) : null
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))).filter(seg => seg.length > 1);
    if (!segments.length) {
      const routePts = [...xml.querySelectorAll('rtept')].map(n => ({
        lat: Number(n.getAttribute('lat')),
        lon: Number(n.getAttribute('lon')),
        ele: n.querySelector('ele') ? Number(n.querySelector('ele').textContent) : null
      })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (routePts.length > 1) segments = [routePts];
    }
    if (!segments.length) throw new Error('Aucun tracé exploitable dans le GPX');
    const points = stitchHikeSegments(segments);
    if (points.length < 2) throw new Error('Impossible de reconstruire le tracé');
    return { segments, points };
  }

  async function fetchWaymarkedHikeGeometry(result) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const url = `${WAYMARKED_HIKING_API}/details/relation/${encodeURIComponent(result.id)}/geometry/gpx`;
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error(`Waymarked Trails ${res.status}`);
      const text = await res.text();
      return parseHikeGpxGeometry(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchOverpassHikeGeometry(result) {
    const query = `[out:json][timeout:30];relation(${result.id})->.r;(.r;way(r.r););out body geom qt;`;
    const data = await fetchOverpass(query, 35000);
    const wayMap = new Map((data.elements || []).filter(el => el.type === 'way').map(w => [Number(w.id), w]));
    const rel = (data.elements || []).find(el => el.type === 'relation' && Number(el.id) === Number(result.id));
    const segments = rel ? relationSegmentsFromElement(rel, wayMap) : [];
    if (!segments.length) throw new Error('Ce parcours ne fournit pas de tracé exploitable');
    const points = stitchHikeSegments(segments);
    if (points.length < 2) throw new Error('Impossible de reconstruire le tracé');
    return { segments, points };
  }

  async function ensureHikeGeometry(result) {
    if (result.points?.length > 1 && result.segments?.length) return result;
    if (result.geometryPromise) return result.geometryPromise;
    result.geometryPromise = (async () => {
      let geometry = null;
      if ((result.profile || 'hike') === 'hike') {
        try { geometry = await fetchWaymarkedHikeGeometry(result); } catch (_) { geometry = await fetchOverpassHikeGeometry(result); }
      } else {
        geometry = await fetchOverpassHikeGeometry(result);
      }
      result.segments = geometry.segments;
      result.points = geometry.points;
      result.distanceKm = routeDistance(result.points);
      renderHikeFinderResults();
      renderHikeFinderMapResults();
      return result;
    })();
    try { return await result.geometryPromise; }
    finally { result.geometryPromise = null; }
  }

  function drawHikePreview(result) {
    // La recherche affiche déjà tous les tracés. On réouvre la vue carte + liste,
    // puis on sélectionne celui-ci et on zoome dessus.
    const index = state.hikeFinder.results.indexOf(result);
    if (index >= 0) {
      state.hikeFinder.active = true;
      ui.hikeFinderPanel.classList.remove('hidden');
      renderHikeFinderMapResults();
      showAppScreen('map', { scroll: false });
      setTimeout(() => {
        enterMapFullscreen();
        if (!state.hikeFinder.resultLayer || !state.hikeFinder.mapLines.length) drawFinderResultsOnMap(false);
        selectFinderResult(index, true);
      }, 70);
      return;
    }
    if (state.hikeFinder.previewLayer) state.map.removeLayer(state.hikeFinder.previewLayer);
    const lines = (result.segments || []).map(seg => seg.map(p => [p.lat, p.lon]));
    state.hikeFinder.previewLayer = L.polyline(lines, { color: '#0f8a67', weight: 6, opacity: .92 }).addTo(state.map);
    showAppScreen('map', { scroll: false });
    setTimeout(() => {
      enterMapFullscreen();
      if (state.hikeFinder.previewLayer) state.map.fitBounds(state.hikeFinder.previewLayer.getBounds(), { padding: [28,28] });
    }, 70);
  }

  async function makeRouteFromHike(result, addRelief = true) {
    await ensureHikeGeometry(result);
    const profileKey = result.profile || state.hikeFinder.profile || 'hike';
    const finderProfile = getFinderProfile(profileKey);
    // Le parcours principal conserve la géométrie détaillée OSM. On ne réutilise
    // plus la version de 190/240 points créée uniquement pour l'altimétrie.
    const geometryPoints = result.points.length > 3000
      ? resampleRouteByDistance(result.points, 3000)
      : result.points.map(p => ({...p}));
    const route = buildRouteObject(result.name, geometryPoints, {
      source: `osm-${profileKey}`,
      transportMode: finderProfile.transportMode,
      plannerProfile: profileKey,
      osmRelationId: result.id,
      osmRef: result.ref || '',
      osmNetwork: result.network || '',
      metrics: result.metrics || null
    });
    if (addRelief) {
      let relief = result.detailRoute || null;
      if (!relief) {
        try { relief = await elevatedRouteCopy(route, 240); } catch (_) { relief = null; }
      }
      if (relief?.high != null) {
        route.gain = relief.gain; route.loss = relief.loss; route.high = relief.high; route.low = relief.low;
        route.rawGain = relief.rawGain; route.rawLoss = relief.rawLoss;
        route.elevationProfile = relief.elevationProfile || relief.points;
        route.elevationFiltered = true;
      }
    }
    route.distanceKm = routeDistance(route.points);
    return route;
  }

  async function handleHikeResultAction(e) {
    const selectBtn = e.target.closest('[data-hike-select]');
    if (selectBtn) {
      const index = Number(selectBtn.dataset.hikeSelect);
      selectFinderResult(index, false);
      return;
    }
    const btn = e.target.closest('button[data-hike-action]');
    const row = e.target.closest('[data-hike-index]');
    if (!btn || !row) return;
    const index = Number(row.dataset.hikeIndex);
    const result = state.hikeFinder.results[index];
    if (!result) return;
    selectFinderResult(index, false);
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = btn.dataset.hikeAction === 'show' ? '…' : 'Chargement…';
    try {
      if (btn.dataset.hikeAction === 'show') {
        await ensureHikeGeometry(result);
        drawHikePreview(result);
      } else {
        await ensureFinderDetails(result);
        const route = await makeRouteFromHike(result, true);
        if (btn.dataset.hikeAction === 'save') {
          saveRouteLocal(route);
          renderSavedRoutes();
          toast(`« ${route.name} » ajouté à Mes parcours.`);
        } else if (btn.dataset.hikeAction === 'load') {
          state.route = route;
          stopHikeFinder(true);
          applyRouteTransportMode(route);
          drawRoute(false);
          renderRouteStats();
          showAppScreen('routes');
          toast(`Parcours chargé : ${route.distanceKm.toFixed(1).replace('.', ',')} km.`);
        }
      }
    } catch (err) {
      toast(err?.message || 'Impossible de charger ce parcours.');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async function handleFinderDetailAction(e) {
    const btn = e.target.closest('[data-finder-detail-action]');
    if (!btn) return;
    const result = state.hikeFinder.results[state.hikeFinder.selectedIndex];
    if (!result) { toast('Sélectionne d’abord un parcours.'); return; }
    const action = btn.dataset.finderDetailAction;
    const previous = btn.innerHTML;
    btn.disabled = true;
    if (action !== 'show') btn.textContent = 'Chargement…';
    try {
      if (action === 'show') {
        await ensureHikeGeometry(result);
        drawHikePreview(result);
        return;
      }
      await ensureFinderDetails(result);
      const route = await makeRouteFromHike(result, true);
      if (action === 'save') {
        saveRouteLocal(route);
        renderSavedRoutes();
        toast(`« ${route.name} » ajouté à Mes parcours.`);
      } else if (action === 'load') {
        state.route = route;
        stopHikeFinder(true);
        applyRouteTransportMode(route);
        drawRoute(false);
        renderRouteStats();
        showAppScreen('routes');
        toast(`Parcours chargé : ${route.distanceKm.toFixed(1).replace('.', ',')} km.`);
      } else if (action === 'start') {
        state.route = route;
        stopHikeFinder(true);
        applyRouteTransportMode(route);
        drawRoute(false);
        renderRouteStats();
        startSelectedRouteActivity();
      }
    } catch (err) {
      toast(err?.message || 'Impossible de préparer ce parcours.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = previous;
    }
  }

  // ---------- Planificateur type Komoot ----------

  function startPlanner() {
    if (state.activity.status === 'recording') {
      toast('Mets d’abord l’activité en pause ou termine-la pour créer un parcours.');
      return;
    }
    state.planner.active = true;
    state.planner.waypoints = [];
    state.planner.routePoints = [];
    state.planner.routeValid = false;
    clearPlannerLayers();
    ui.plannerPanel.classList.remove('hidden');
    ui.mapWrap.classList.add('planning');
    const profile = getPlannerProfile();
    ui.plannerStatus.textContent = `${profile.icon} ${profile.label} · Touchez la carte pour placer le départ.`;
    updatePlannerButtons();
    showAppScreen('map', { scroll: false });
    setTimeout(() => enterMapFullscreen(), 60);
  }

  function stopPlanner(clear = true) {
    state.planner.active = false;
    clearTimeout(state.planner.routeTimer);
    state.planner.routeTimer = null;
    ui.plannerPanel.classList.add('hidden');
    ui.mapWrap.classList.remove('planning');
    if (clear) {
      state.planner.waypoints = [];
      state.planner.routePoints = [];
      clearPlannerLayers();
    }
  }

  function clearPlannerLayers() {
    if (state.planner.line) state.map.removeLayer(state.planner.line);
    state.planner.line = null;
    state.planner.markers.forEach(m => state.map.removeLayer(m));
    state.planner.markers = [];
  }

  function addPlannerWaypoint(point) {
    state.planner.waypoints.push(point);
    renderPlannerMarkers();
    updatePlannerButtons();
    if (state.planner.waypoints.length === 1) {
      state.planner.routePoints = [{ ...point }];
      state.planner.routeValid = false;
      ui.plannerStatus.textContent = `${getPlannerProfile().icon} ${getPlannerProfile().label} · Départ placé. Ajoute l’arrivée ou une étape.`;
      drawPlannerLine(state.planner.routePoints, true);
      return;
    }
    state.planner.routeValid = false;
    ui.plannerStatus.textContent = `${getPlannerProfile().icon} Calcul du parcours…`;
    // On ne dessine plus de liaison droite provisoire : seuls les vrais tracés routés
    // sont affichés. L'ancien tracé routé reste éventuellement visible pendant le recalcul.
    schedulePlannerRoute();
  }

  function renderPlannerMarkers() {
    state.planner.markers.forEach(m => state.map.removeLayer(m));
    state.planner.markers = state.planner.waypoints.map((p, i, arr) => {
      const cls = i === 0 ? 'start' : (i === arr.length - 1 ? 'end' : '');
      const label = i === 0 ? 'D' : (i === arr.length - 1 ? 'A' : String(i));
      const icon = L.divIcon({ className: '', html: `<div class="plan-waypoint ${cls}">${label}</div>`, iconSize:[24,24], iconAnchor:[12,12] });
      return L.marker([p.lat, p.lon], { icon, zIndexOffset: 800 }).addTo(state.map);
    });
  }

  function updatePlannerButtons() {
    const n = state.planner.waypoints.length;
    ui.plannerUndoBtn.disabled = n === 0;
    ui.plannerClearBtn.disabled = n === 0;
    ui.plannerSaveBtn.disabled = n < 2 || state.planner.routing || !state.planner.routeValid;
  }

  function undoPlannerWaypoint() {
    if (!state.planner.waypoints.length) return;
    state.planner.waypoints.pop();
    renderPlannerMarkers();
    updatePlannerButtons();
    if (!state.planner.waypoints.length) {
      state.planner.routePoints = [];
      state.planner.routeValid = false;
      if (state.planner.line) state.map.removeLayer(state.planner.line);
      state.planner.line = null;
      ui.plannerStatus.textContent = `${getPlannerProfile().icon} ${getPlannerProfile().label} · Touchez la carte pour placer le départ.`;
    } else if (state.planner.waypoints.length === 1) {
      state.planner.routePoints = [{...state.planner.waypoints[0]}];
      state.planner.routeValid = false;
      drawPlannerLine(state.planner.routePoints, true);
      ui.plannerStatus.textContent = `${getPlannerProfile().icon} ${getPlannerProfile().label} · Ajoutez une arrivée ou une étape.`;
    } else {
      schedulePlannerRoute();
    }
  }

  function clearPlanner() {
    state.planner.waypoints = [];
    state.planner.routePoints = [];
    clearPlannerLayers();
    ui.plannerStatus.textContent = `${getPlannerProfile().icon} ${getPlannerProfile().label} · Touchez la carte pour placer le départ.`;
    updatePlannerButtons();
  }

  function useGpsAsPlannerStart() {
    if (!state.location) {
      startLocation(true);
      toast('Recherche de ta position GPS…');
      return;
    }
    if (!state.planner.waypoints.length) addPlannerWaypoint({ lat: state.location.lat, lon: state.location.lon });
    else {
      state.planner.waypoints[0] = { lat: state.location.lat, lon: state.location.lon };
      renderPlannerMarkers();
      if (state.planner.waypoints.length > 1) schedulePlannerRoute();
    }
    state.map.setView([state.location.lat, state.location.lon], Math.max(state.map.getZoom(), 14));
  }

  function schedulePlannerRoute() {
    clearTimeout(state.planner.routeTimer);
    const elapsed = Date.now() - state.planner.lastRequestAt;
    const wait = Math.max(150, ROUTER_MIN_INTERVAL - elapsed);
    state.planner.routeTimer = setTimeout(routePlannerWaypoints, wait);
  }

  async function fetchPlannerJson(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('routing-timeout'), timeoutMs);
    try {
      const res = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function plannerCoordinatesFromResponse(data) {
    const geometry = data?.routes?.[0]?.geometry;
    if (geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)) return geometry.coordinates;
    if (Array.isArray(geometry?.coordinates)) return geometry.coordinates;
    return null;
  }

  async function routeWithOsrm(profile, serial) {
    const prefix = profile.activityMode === 'hike' ? 'routed-foot' : 'routed-bike';
    const coords = state.planner.waypoints.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const url = `https://routing.openstreetmap.de/${prefix}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    const data = await fetchPlannerJson(url, {}, 7000);
    if (serial !== state.planner.requestSerial) return null;
    const coordsOut = plannerCoordinatesFromResponse(data);
    if (!Array.isArray(coordsOut) || coordsOut.length < 2) throw new Error('Aucun chemin OSM trouvé');
    return coordsOut;
  }

  function pointSegmentDistanceMeters(p, a, b) {
    // Approximation locale suffisante pour faire correspondre un point du tracé
    // à la voie OSM la plus proche (rayons de quelques dizaines de mètres).
    const lat0 = rad(p.lat);
    const kx = 111320 * Math.cos(lat0);
    const ky = 110540;
    const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky;
    const bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
    const vx = bx - ax, vy = by - ay;
    const vv = vx * vx + vy * vy;
    let t = vv > 0 ? -((ax * vx) + (ay * vy)) / vv : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * vx, y = ay + t * vy;
    return Math.hypot(x, y);
  }

  function pointWayDistanceMeters(point, geometry) {
    if (!Array.isArray(geometry) || geometry.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1], b = geometry[i];
      if (!Number.isFinite(a?.lat) || !Number.isFinite(a?.lon) || !Number.isFinite(b?.lat) || !Number.isFinite(b?.lon)) continue;
      best = Math.min(best, pointSegmentDistanceMeters(point, a, b));
    }
    return best;
  }

  function roadWayAssessment(tags = {}) {
    const highway = String(tags.highway || '').toLowerCase();
    const surface = String(tags.surface || '').toLowerCase();
    const smoothness = String(tags.smoothness || '').toLowerCase();
    const bicycle = String(tags.bicycle || '').toLowerCase();
    const paved = PAVED_SURFACES.has(surface);
    const roughSurface = GRAVEL_SURFACES.has(surface);
    const badSmoothness = ['bad','very_bad','horrible','very_horrible','impassable'].includes(smoothness);
    const pathLike = ['track','path','bridleway','footway','pedestrian'].includes(highway);
    const normalRoad = ['motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','road'].includes(highway);
    const cycleway = highway === 'cycleway';

    // Profil Vélo route STRICT :
    // - toute surface explicitement gravel/terre/non revêtue est rejetée ;
    // - track/path/footway/etc. sans preuve de revêtement est rejeté ;
    // - une vraie route sans tag surface reste acceptée (OSM ne renseigne pas
    //   toujours surface=asphalt sur les routes ordinaires) ;
    // - une piste cyclable reste acceptée sauf si sa surface est explicitement mauvaise.
    let bad = false;
    let reason = '';
    if (bicycle === 'no') { bad = true; reason = 'interdit vélo'; }
    else if (highway === 'steps') { bad = true; reason = 'escaliers'; }
    else if (roughSurface) { bad = true; reason = `surface ${surface || 'non revêtue'}`; }
    else if (badSmoothness) { bad = true; reason = 'surface dégradée'; }
    else if (pathLike && !paved) { bad = true; reason = 'chemin/sentier non revêtu'; }
    else if (!highway) { bad = true; reason = 'type de voie inconnu'; }
    else if (!paved && !normalRoad && !cycleway) {
      // Une voie atypique non explicitement revêtue n'est pas considérée sûre
      // pour un vélo de route à pneus fins.
      bad = true;
      reason = 'revêtement non garanti';
    }

    return { bad, reason, highway, surface, paved, normalRoad, cycleway };
  }

  async function fetchOverpassFast(query, timeoutMs = 5200) {
    let lastError = null;
    // Contrôle secondaire : on limite volontairement à deux instances pour ne pas
    // retarder longtemps le planificateur si Overpass est chargé.
    for (const endpoint of OVERPASS_ENDPOINTS.slice(0, 2)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('road-surface-timeout'), timeoutMs);
      try {
        const body = new URLSearchParams({ data: query });
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
          cache: 'no-store',
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const data = await res.json();
        if (!data || !Array.isArray(data.elements)) throw new Error('Réponse Overpass invalide');
        return data;
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Contrôle surfaces indisponible');
  }

  async function inspectRoadRouteSurface(coordsOut, serial) {
    const points = (coordsOut || []).map(c => ({ lon: Number(c[0]), lat: Number(c[1]) }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (points.length < 2) return { inconclusive: true, shouldRefine: false, badRatio: 0 };

    const km = routeDistance(points);
    const count = Math.max(10, Math.min(48, Math.ceil(km / 0.40) + 1));
    const samples = sampleRoute(points, count).map(x => x.point);
    const query = `[out:json][timeout:12];(\n${samples.map(p =>
      `way(around:32,${p.lat.toFixed(6)},${p.lon.toFixed(6)})[\"highway\"];`
    ).join('\n')}\n);out tags geom;`;

    let data;
    try {
      data = await fetchOverpassFast(query, 5200);
    } catch (_) {
      return { inconclusive: true, shouldRefine: false, badRatio: 0, matchedRatio: 0 };
    }
    if (serial !== state.planner.requestSerial) return null;

    const ways = (data.elements || []).filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 1);
    if (!ways.length) return { inconclusive: true, shouldRefine: false, badRatio: 0, matchedRatio: 0 };

    let matched = 0, bad = 0;
    const reasons = new Map();
    for (const sample of samples) {
      let best = null, bestD = Infinity;
      for (const way of ways) {
        const d = pointWayDistanceMeters(sample, way.geometry);
        if (d < bestD) { bestD = d; best = way; }
      }
      if (!best || bestD > 24) continue;
      matched++;
      const assessment = roadWayAssessment(best.tags || {});
      if (assessment.bad) {
        bad++;
        const key = assessment.reason || 'voie inadaptée';
        reasons.set(key, (reasons.get(key) || 0) + 1);
      }
    }

    const matchedRatio = matched / Math.max(samples.length, 1);
    if (matched < Math.max(4, Math.ceil(samples.length * 0.40))) {
      return { inconclusive: true, shouldRefine: false, badRatio: 0, matchedRatio };
    }
    const badRatio = bad / matched;
    const topReasons = [...reasons.entries()].sort((a,b) => b[1] - a[1]).slice(0,2).map(([name]) => name);
    return {
      inconclusive: false,
      shouldRefine: bad > 0,
      badRatio,
      matchedRatio,
      reasons: topReasons
    };
  }

  async function routeWithValhalla(profile, serial) {
    const payload = {
      locations: state.planner.waypoints.map((p, i, arr) => ({
        lat: Number(p.lat.toFixed(6)),
        lon: Number(p.lon.toFixed(6)),
        type: (i === 0 || i === arr.length - 1) ? 'break' : 'through'
      })),
      costing: profile.costing,
      costing_options: profile.costingOptions,
      format: 'osrm',
      shape_format: 'geojson',
      directions_type: 'none',
      units: 'kilometers',
      id: 'rando-radar-web'
    };

    // GET évite la requête CORS preflight provoquée par le POST + en-têtes personnalisés.
    const url = `${VALHALLA_ROUTE_URL}?json=${encodeURIComponent(JSON.stringify(payload))}`;
    const data = await fetchPlannerJson(url, { method: 'GET', mode: 'cors' }, 3500);
    if (serial !== state.planner.requestSerial) return null;
    const coordsOut = plannerCoordinatesFromResponse(data);
    if (!Array.isArray(coordsOut) || coordsOut.length < 2) throw new Error('Aucun chemin Valhalla trouvé');
    return coordsOut;
  }

  async function routePlannerWaypoints() {
    if (state.planner.waypoints.length < 2) return;
    state.planner.routing = true;
    state.planner.routeValid = false;
    state.planner.lastRequestAt = Date.now();
    const serial = ++state.planner.requestSerial;
    const profile = getPlannerProfile();
    const previousPoints = Array.isArray(state.planner.routePoints) ? state.planner.routePoints.map(p => ({...p})) : [];
    const hadPreviousRoute = previousPoints.length > 1 && !!state.planner.line;
    updatePlannerButtons();
    ui.plannerStatus.textContent = `${profile.icon} Calcul du parcours ${profile.label}…`;

    try {
      let coordsOut = null;
      let sourceLabel = '';
      let usedFallback = false;

      if (profile.activityMode === 'hike') {
        // Randonnée : OSM piéton en priorité, comme dans les premières versions.
        try {
          coordsOut = await routeWithOsrm(profile, serial);
          sourceLabel = 'OSM piéton';
        } catch (osmErr) {
          if (serial !== state.planner.requestSerial) return;
          usedFallback = true;
          ui.plannerStatus.textContent = `${profile.icon} OSM piéton indisponible · secours Valhalla…`;
          coordsOut = await routeWithValhalla(profile, serial);
          sourceLabel = 'Valhalla piéton';
        }
      } else if (profile.activityMode === 'road') {
        // Vélo route : OSM est visible immédiatement pour conserver la réactivité.
        // Ensuite on contrôle strictement les types de voies et les surfaces.
        // Au moindre échantillon clairement non revêtu, Valhalla Road recalcule.
        try {
          coordsOut = await routeWithOsrm(profile, serial);
          if (serial !== state.planner.requestSerial || !coordsOut) return;

          const instantPoints = coordsOut.map(c => ({ lon: Number(c[0]), lat: Number(c[1]), ele: null }));
          state.planner.routePoints = instantPoints;
          state.planner.routeValid = false; // visible immédiatement, verrouillé pendant le contrôle
          drawPlannerLine(instantPoints, false);
          updatePlannerButtons();
          ui.plannerStatus.textContent = `${profile.icon} ${routeDistance(instantPoints).toFixed(1)} km · OSM vélo · vérification revêtement…`;

          let check = await inspectRoadRouteSurface(coordsOut, serial);
          if (serial !== state.planner.requestSerial || !check) return;

          // Si le contrôle OSM détecte une seule portion clairement incompatible
          // OU si le contrôle est impossible, on préfère le profil Road de Valhalla.
          if (check.shouldRefine || check.inconclusive) {
            const why = check.shouldRefine && Array.isArray(check.reasons) && check.reasons.length
              ? ` (${check.reasons.join(', ')})`
              : '';
            ui.plannerStatus.textContent = check.shouldRefine
              ? `${profile.icon} Portion non adaptée détectée${why} · recalcul route revêtue…`
              : `${profile.icon} Revêtement OSM non vérifiable · recalcul Valhalla Route…`;

            try {
              const refined = await routeWithValhalla(profile, serial);
              if (serial !== state.planner.requestSerial || !refined) return;
              coordsOut = refined;
              sourceLabel = check.shouldRefine ? 'Valhalla Route · corrigé' : 'Valhalla Route · sécurité';

              // Deuxième contrôle : on ne valide pas silencieusement un itinéraire
              // Valhalla qui emprunterait encore une portion explicitement non revêtue.
              const refinedCheck = await inspectRoadRouteSurface(refined, serial);
              if (serial !== state.planner.requestSerial || !refinedCheck) return;
              if (!refinedCheck.inconclusive && refinedCheck.shouldRefine) {
                const why2 = Array.isArray(refinedCheck.reasons) && refinedCheck.reasons.length
                  ? ` (${refinedCheck.reasons.join(', ')})`
                  : '';
                const refinedPoints = refined.map(c => ({ lon: Number(c[0]), lat: Number(c[1]), ele: null }));
                state.planner.routePoints = refinedPoints;
                state.planner.routeValid = false;
                drawPlannerLine(refinedPoints, false);
                ui.plannerStatus.textContent = `${profile.icon} ⚠ Aucun itinéraire 100 % adapté vélo route trouvé${why2}. Ajoute un point intermédiaire sur une route revêtue.`;
                updatePlannerButtons();
                return;
              }
              if (refinedCheck.inconclusive) {
                sourceLabel += ' · revêtement partiellement non vérifiable';
              }
            } catch (_) {
              if (serial !== state.planner.requestSerial) return;
              // Si OSM était explicitement mauvais, on ne permet PAS d'enregistrer
              // ce trajet juste parce que Valhalla est indisponible.
              if (check.shouldRefine) {
                state.planner.routePoints = instantPoints;
                state.planner.routeValid = false;
                drawPlannerLine(instantPoints, false);
                ui.plannerStatus.textContent = `${profile.icon} ⚠ Le tracé OSM contient une portion non revêtue et Valhalla Route ne répond pas. Enregistrement bloqué.`;
                updatePlannerButtons();
                return;
              }
              // Contrôle seulement inconclusif : on garde le tracé OSM avec avertissement.
              coordsOut = coordsOut;
              sourceLabel = 'OSM vélo · ⚠ revêtement non vérifiable';
            }
          } else {
            sourceLabel = 'OSM vélo · revêtement contrôlé';
          }
        } catch (osmErr) {
          if (serial !== state.planner.requestSerial) return;
          usedFallback = true;
          ui.plannerStatus.textContent = `${profile.icon} OSM vélo indisponible · secours Valhalla Route…`;
          coordsOut = await routeWithValhalla(profile, serial);
          sourceLabel = 'Valhalla Route';

          // Même en secours, on essaie de vérifier qu'aucune portion explicitement
          // gravel/terre/path non revêtue n'est présente.
          const fallbackCheck = await inspectRoadRouteSurface(coordsOut, serial);
          if (serial !== state.planner.requestSerial || !fallbackCheck) return;
          if (!fallbackCheck.inconclusive && fallbackCheck.shouldRefine) {
            const fallbackPoints = coordsOut.map(c => ({ lon: Number(c[0]), lat: Number(c[1]), ele: null }));
            state.planner.routePoints = fallbackPoints;
            state.planner.routeValid = false;
            drawPlannerLine(fallbackPoints, false);
            ui.plannerStatus.textContent = `${profile.icon} ⚠ Le seul itinéraire trouvé comporte une portion non revêtue. Enregistrement bloqué.`;
            updatePlannerButtons();
            return;
          }
          if (fallbackCheck.inconclusive) sourceLabel += ' · revêtement partiellement non vérifiable';
        }
      } else {
        // Gravel / VTT : profils spécialisés Valhalla en priorité.
        try {
          coordsOut = await routeWithValhalla(profile, serial);
          sourceLabel = profile.activityMode === 'gravel' ? 'Valhalla Cross' : 'Valhalla Mountain';
        } catch (advancedErr) {
          if (serial !== state.planner.requestSerial) return;
          usedFallback = true;
          ui.plannerStatus.textContent = `${profile.icon} ${profile.label} indisponible · secours OSM vélo…`;
          coordsOut = await routeWithOsrm(profile, serial);
          sourceLabel = 'OSM vélo générique';
        }
      }

      if (serial !== state.planner.requestSerial || !coordsOut) return;
      state.planner.routePoints = coordsOut.map(c => ({ lon: Number(c[0]), lat: Number(c[1]), ele: null }));
      state.planner.routeValid = true;
      drawPlannerLine(state.planner.routePoints, false);
      const km = routeDistance(state.planner.routePoints);
      ui.plannerStatus.textContent = usedFallback
        ? `${profile.icon} ${km.toFixed(1)} km · ${sourceLabel} (secours).`
        : `${profile.icon} ${km.toFixed(1)} km · ${sourceLabel} · ${profile.description}.`;
    } catch (err) {
      if (serial !== state.planner.requestSerial) return;
      // Pas de fausse ligne droite. Si un ancien itinéraire routé existait, on le conserve
      // visuellement mais il ne peut pas être enregistré tant que le nouveau calcul a échoué.
      if (hadPreviousRoute) {
        state.planner.routePoints = previousPoints;
      } else {
        state.planner.routePoints = [];
        if (state.planner.line) {
          state.map.removeLayer(state.planner.line);
          state.planner.line = null;
        }
      }
      state.planner.routeValid = false;
      const isTimeout = err?.name === 'AbortError' || String(err?.message || '').includes('routing-timeout');
      ui.plannerStatus.textContent = isTimeout
        ? 'Le routeur met trop de temps à répondre. Aucun faux tracé n’est affiché — réessaie dans quelques secondes.'
        : 'Impossible de calculer un vrai itinéraire. Réessaie ou déplace légèrement le dernier point.';
    } finally {
      if (serial === state.planner.requestSerial) {
        state.planner.routing = false;
        updatePlannerButtons();
      }
    }
  }

  function drawPlannerLine(points, direct) {
    if (state.planner.line) state.map.removeLayer(state.planner.line);
    if (!points.length) return;
    state.planner.line = L.polyline(points.map(p => [p.lat, p.lon]), {
      color: '#f59e0b', weight: 5, opacity: .95, dashArray: direct ? '8 8' : null
    }).addTo(state.map);
  }

  async function savePlannerRoute() {
    if (state.planner.routePoints.length < 2) return;
    ui.plannerSaveBtn.disabled = true;
    ui.plannerStatus.textContent = 'Récupération du relief…';
    const profile = getPlannerProfile();
    const defaultName = `${profile.label} ${new Date().toLocaleDateString('fr-FR')}`;
    try {
      const entered = window.prompt('Nom du parcours', defaultName);
      const name = (entered || defaultName).trim().slice(0, 80) || defaultName;
      const geometry = state.planner.routePoints.length > 3000
        ? resampleRouteByDistance(state.planner.routePoints, 3000)
        : state.planner.routePoints.map(p => ({...p}));
      const route = buildRouteObject(name, geometry, { source: 'planner', plannerProfile: state.planner.mode, transportMode: profile.activityMode === 'hike' ? 'hike' : 'bike' });
      try {
        const relief = await elevatedRouteCopy(route, 240);
        if (relief.high != null) {
          route.gain = relief.gain; route.loss = relief.loss; route.high = relief.high; route.low = relief.low;
          route.rawGain = relief.rawGain; route.rawLoss = relief.rawLoss;
          route.elevationProfile = relief.elevationProfile || relief.points;
          route.elevationFiltered = true;
        }
      } catch (_) { /* parcours conservé même si le relief est indisponible */ }
      route.distanceKm = routeDistance(route.points);
      saveRouteLocal(route);
      state.route = route;
      drawRoute(false);
      renderRouteStats();
      stopPlanner(true);
      renderSavedRoutes();
      toast(`Parcours « ${name} » enregistré.`);
    } catch (err) {
      toast('Impossible d’enregistrer ce parcours.');
    } finally {
      ui.plannerSaveBtn.disabled = false;
    }
  }

  async function addElevations(points) {
    const out = points.map(p => ({...p}));
    for (let start = 0; start < out.length; start += 100) {
      const chunk = out.slice(start, start + 100);
      const params = new URLSearchParams({
        latitude: chunk.map(p => Number(p.lat).toFixed(6)).join(','),
        longitude: chunk.map(p => Number(p.lon).toFixed(6)).join(',')
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('elevation-timeout'), 12000);
      let res;
      try {
        res = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`, { cache: 'no-store', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res?.ok) throw new Error('Altitude indisponible');
      const data = await res.json();
      const elevations = Array.isArray(data.elevation) ? data.elevation : [];
      if (elevations.length !== chunk.length) throw new Error('Réponse altitude incomplète');
      elevations.forEach((ele, i) => {
        if (hasElevation(ele)) out[start + i].ele = Number(ele);
      });
    }
    const valid = out.filter(p => hasElevation(p.ele)).length;
    if (valid / Math.max(1, out.length) < .9) throw new Error('Altitude incomplète');
    return out;
  }

  function saveRouteLocal(route) {
    const list = getSavedRoutes();
    const item = { ...route, id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}` };
    list.unshift(item);
    try {
      localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(list.slice(0, 20)));
    } catch (err) {
      toast('Stockage local plein : exporte le GPX pour conserver le parcours.');
    }
  }

  function getSavedRoutes() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVED_ROUTES_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  }

  function renderSavedRoutes() {
    const list = getSavedRoutes();
    ui.savedRoutesCard.classList.toggle('hidden', !list.length);
    ui.savedRoutesList.innerHTML = list.map(r => `
      <div class="saved-route-item" data-route-id="${escapeHtml(r.id)}">
        <div><strong>${escapeHtml(r.name || 'Parcours')}</strong><div class="saved-meta">${r.plannerProfile && PLANNER_PROFILES[r.plannerProfile] ? `${PLANNER_PROFILES[r.plannerProfile].icon} ${escapeHtml(PLANNER_PROFILES[r.plannerProfile].label)} · ` : ''}${Number(r.distanceKm || 0).toFixed(1)} km${Number.isFinite(r.gain) ? ` · D+ ${Math.round(r.gain)} m` : ''}</div></div>
        <div class="saved-route-actions">
          <button type="button" data-action="load" title="Afficher">🗺️</button>
          <button type="button" data-action="gpx" title="Exporter GPX">GPX</button>
          <button type="button" data-action="delete" class="delete" title="Supprimer">✕</button>
        </div>
      </div>`).join('');
  }

  function handleSavedRouteAction(e) {
    const btn = e.target.closest('button[data-action]');
    const row = e.target.closest('[data-route-id]');
    if (!btn || !row) return;
    const list = getSavedRoutes();
    const route = list.find(r => r.id === row.dataset.routeId);
    if (!route) return;
    if (btn.dataset.action === 'load') {
      state.route = route;
      drawRoute(true);
      renderRouteStats();
      toast(`Parcours chargé : ${route.name}`);
    } else if (btn.dataset.action === 'gpx') {
      downloadGpx(route.name, route.points, 'route');
    } else if (btn.dataset.action === 'delete') {
      if (!window.confirm(`Supprimer « ${route.name} » ?`)) return;
      localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(list.filter(r => r.id !== route.id)));
      renderSavedRoutes();
    }
  }

  // ---------- Persistance activité en cours v1.10.13 ----------

  function compactRouteForActivity(route) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2) return null;
    const clonePoint = p => ({
      lat: Number(p.lat), lon: Number(p.lon),
      ele: hasElevation(p.ele) ? Number(p.ele) : null,
      time: p.time || null,
      distanceKm: Number.isFinite(Number(p.distanceKm)) ? Number(p.distanceKm) : undefined
    });
    const clean = {
      name: route.name || 'Parcours',
      points: route.points.map(clonePoint).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
      distanceKm: Number(route.distanceKm) || routeDistance(route.points),
      gain: Number.isFinite(Number(route.gain)) ? Number(route.gain) : 0,
      loss: Number.isFinite(Number(route.loss)) ? Number(route.loss) : 0,
      high: hasElevation(route.high) ? Number(route.high) : null,
      low: hasElevation(route.low) ? Number(route.low) : null,
      rawGain: Number.isFinite(Number(route.rawGain)) ? Number(route.rawGain) : null,
      rawLoss: Number.isFinite(Number(route.rawLoss)) ? Number(route.rawLoss) : null,
      elevationFiltered: Boolean(route.elevationFiltered),
      plannerProfile: route.plannerProfile || null,
      transportMode: route.transportMode || null,
      source: route.source || null,
      createdAt: route.createdAt || Date.now()
    };
    if (Array.isArray(route.elevationProfile) && route.elevationProfile.length) {
      clean.elevationProfile = route.elevationProfile.map(clonePoint).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    }
    return clean;
  }

  function persistActivitySnapshot(force = false) {
    const a = state.activity;
    if (!['recording','paused','finished'].includes(a.status)) {
      try { localStorage.removeItem(ACTIVE_ACTIVITY_KEY); } catch (_) {}
      return;
    }
    const now = Date.now();
    if (!force && now - lastActivityPersistAt < 2500) return;
    lastActivityPersistAt = now;
    const snapshot = {
      version: 1,
      savedAt: now,
      status: a.status,
      mode: a.mode,
      startedAt: a.startedAt,
      pausedAt: a.pausedAt,
      pausedMs: a.pausedMs || 0,
      finishedAt: a.finishedAt,
      nativeSessionId: a.nativeSessionId || '',
      points: a.nativeSessionId ? [] : (a.points || []).map(p => ({
        lat: Number(p.lat), lon: Number(p.lon),
        ele: hasElevation(p.ele) ? Number(p.ele) : null,
        time: p.time || null,
        timestamp: Number(p.timestamp) || null,
        accuracy: Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null
      })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
      distanceKm: Number(a.distanceKm) || 0,
      currentSpeed: Number(a.currentSpeed) || 0,
      name: a.name || '',
      target: a.target && Number.isFinite(Number(a.target.lat)) && Number.isFinite(Number(a.target.lon))
        ? { lat:Number(a.target.lat), lon:Number(a.target.lon) } : null,
      followRoute: compactRouteForActivity(a.followRoute),
      followRouteLastIndex: Number.isInteger(a.followRouteLastIndex) ? a.followRouteLastIndex : null,
      mapFullscreen: Boolean(state.mapFullscreen)
    };
    try {
      localStorage.setItem(ACTIVE_ACTIVITY_KEY, JSON.stringify(snapshot));
      activityPersistWarned = false;
    } catch (err) {
      if (!activityPersistWarned) {
        activityPersistWarned = true;
        toast('Impossible de sauvegarder automatiquement l’activité sur le téléphone.');
      }
    }
  }

  function clearPersistedActivity() {
    try { localStorage.removeItem(ACTIVE_ACTIVITY_KEY); } catch (_) {}
    lastActivityPersistAt = 0;
  }

  function restoreActivitySnapshot() {
    let snap;
    try { snap = JSON.parse(localStorage.getItem(ACTIVE_ACTIVITY_KEY) || 'null'); }
    catch (_) { clearPersistedActivity(); return false; }
    if (!snap || !['recording','paused','finished'].includes(snap.status)) return false;

    // Les versions précédentes enregistraient l'activité via la WebView : écran éteint,
    // Android pouvait mettre les callbacks en file d'attente et créer de grandes lignes droites.
    // On ne restaure pas une ancienne activité encore en cours sans session native.
    if (['recording','paused'].includes(snap.status) && getNativeActivityTracker() && !snap.nativeSessionId) {
      clearPersistedActivity();
      return false;
    }

    // Évite de ressusciter une activité oubliée depuis plusieurs jours.
    if (!snap.savedAt || Date.now() - Number(snap.savedAt) > 48 * 3600 * 1000) {
      clearPersistedActivity();
      return false;
    }

    const pts = Array.isArray(snap.points) ? snap.points.map(p => ({
      lat:Number(p.lat), lon:Number(p.lon),
      ele:hasElevation(p.ele) ? Number(p.ele) : null,
      time:p.time || null,
      timestamp:Number(p.timestamp) || Date.now(),
      accuracy:Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];

    const mode = ACTIVITY_PROFILES[snap.mode] ? snap.mode : 'hike';
    const followRoute = snap.followRoute && Array.isArray(snap.followRoute.points) && snap.followRoute.points.length > 1
      ? snap.followRoute : null;

    clearActivityTrack();
    clearActivityTarget();
    state.activity.status = snap.status;
    state.activity.mode = mode;
    state.activity.startedAt = Number(snap.startedAt) || Date.now();
    state.activity.pausedAt = snap.status === 'paused' ? (Number(snap.pausedAt) || Date.now()) : null;
    state.activity.pausedMs = Number(snap.pausedMs) || 0;
    state.activity.finishedAt = Number(snap.finishedAt) || null;
    state.activity.points = pts;
    state.activity.distanceKm = Number(snap.distanceKm) || (pts.length > 1 ? routeDistance(pts) : 0);
    state.activity.currentSpeed = snap.status === 'recording' ? (Number(snap.currentSpeed) || 0) : 0;
    state.activity.name = snap.name || `${getActivityProfile(mode).label} restaurée`;
    state.activity.nativeSessionId = typeof snap.nativeSessionId === 'string' ? snap.nativeSessionId : '';
    state.activity.followRoute = followRoute;
    state.activity.followRouteCumKm = followRoute ? buildCumulativeRouteKm(followRoute.points) : null;
    state.activity.followRouteLastIndex = Number.isInteger(snap.followRouteLastIndex) ? snap.followRouteLastIndex : null;
    state.activity.offRouteAlerted = false;
    state.activity.line = L.polyline(pts.map(p => [p.lat,p.lon]), { color:'#fb7185', weight:5, opacity:.96 }).addTo(state.map);

    if (followRoute) {
      state.route = followRoute;
      drawRoute(false);
      renderRouteStats();
    }

    if (snap.target && Number.isFinite(Number(snap.target.lat)) && Number.isFinite(Number(snap.target.lon))) {
      const point = { lat:Number(snap.target.lat), lon:Number(snap.target.lon) };
      state.activity.target = point;
      const icon = L.divIcon({ className:'', html:'<div class="target-marker">🎯</div>', iconSize:[34,34], iconAnchor:[17,17] });
      state.activity.targetMarker = L.marker([point.lat, point.lon], { icon, zIndexOffset:900 }).addTo(state.map);
      state.activity.targetLine = L.polyline([], { color:'#fbbf24', weight:3, opacity:.9, dashArray:'7 8' }).addTo(state.map);
      ui.targetGuide.classList.remove('hidden');
    }

    ensureActivityUiTimer();
    syncActivityMapPanel();

    if (snap.status === 'recording' || snap.status === 'paused') {
      startLocation(false);
      if (snap.status === 'recording') enableGpsMapFollow({ raiseZoom: false });
      if (state.activity.nativeSessionId && getNativeActivityTracker()) {
        // Le vrai état du service sera relu juste après le chargement.
        // Cela évite de repartir avec une interface vide alors que la trace native existe déjà.
        recoverNativeActivityState({ reason:'snapshot-restore', allowRestart: snap.status === 'recording' }).catch(() => {});
      }
      setAlert('safe', '↻', 'Activité restaurée', `${getActivityProfile(mode).label} reprise après le rechargement de la page.`);
      toast(snap.status === 'paused' ? 'Activité restaurée en pause.' : 'Activité restaurée · GPS repris.');
      if (snap.mapFullscreen) {
        setTimeout(() => {
          showAppScreen('map', { scroll:false });
          enterMapFullscreen();
          syncActivityMapPanel();
        }, 120);
      }
    }
    // Réécrit immédiatement l'état restauré : même un second rechargement
    // juste après le premier ne peut pas perdre l'activité.
    if (state.activity.nativeSessionId && getNativeActivityTracker()) {
      recoverNativeActivityState({ reason:'restore-final', allowRestart: snap.status === 'recording' }).catch(() => {});
    }
    persistActivitySnapshot(true);
    return true;
  }

  // ---------- Activité GPS en direct ----------

  function openActivityCard() {
    ui.activityCard.classList.remove('hidden');
    updateActivityUI();
  }

  function startActivity(routeToFollow = null) {
    if (state.planner.active) stopPlanner(true);
    if (routeToFollow) state.activity.mode = activityModeForRoute(routeToFollow);
    clearActivityTrack();
    clearActivityTarget();
    state.activity.followRoute = routeToFollow || null;
    state.activity.followRouteCumKm = routeToFollow ? buildCumulativeRouteKm(routeToFollow.points) : null;
    state.activity.followRouteLastIndex = null;
    state.activity.offRouteAlerted = false;
    state.activity.status = 'recording';
    state.activity.startedAt = Date.now();
    state.activity.pausedAt = null;
    state.activity.pausedMs = 0;
    state.activity.finishedAt = null;
    state.activity.points = [];
    state.activity.distanceKm = 0;
    state.activity.currentSpeed = 0;
    state.activity.nativeSessionId = getNativeActivityTracker() ? makeNativeActivitySessionId() : '';
    const activityProfile = getActivityProfile();
    state.activity.name = routeToFollow
      ? `${routeToFollow.name} · ${activityProfile.label} · ${new Date().toLocaleString('fr-FR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}`
      : `${activityProfile.label} ${new Date().toLocaleString('fr-FR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}`;
    state.activity.line = L.polyline([], { color:'#fb7185', weight:5, opacity:.96 }).addTo(state.map);
    persistActivitySnapshot(true);
    startLocation(false);
    enableGpsMapFollow({ raiseZoom: true });
    if (state.activity.nativeSessionId) {
      startNativeActivityLocation({ clear:true }).then(ok => {
        if (!ok && state.location) recordActivityPoint(state.location, true);
      });
    } else if (state.location) {
      recordActivityPoint(state.location, true);
    }
    ensureActivityUiTimer();
    if (routeToFollow) {
      drawRoute(false);
      setAlert('safe', '🧭', 'Suivi du GPX en cours', `${routeToFollow.name} · le tracé bleu reste affiché et ta trace réelle est enregistrée en rose.`);
      toast(`Parcours démarré : ${routeToFollow.name}`);
      setTimeout(() => { if (state.routeLine) state.map.fitBounds(state.routeLine.getBounds(), { padding: [34, 34] }); }, 100);
    } else {
      setAlert('safe', '▶️', 'Activité en cours', 'La trace GPS est enregistrée. La carte reste libre : ◎ te recentre sur ta position.');
      toast('Enregistrement GPS démarré.');
    }

    // Prépare automatiquement une carte de secours sans retarder le démarrage.
    // Le GPX entier est couvert lorsqu'un parcours est suivi ; sinon on utilise
    // une zone de 5 km autour du point de départ dès que le GPS est disponible.
    if (navigator.onLine) {
      if (routeToFollow) autoPrepareOfflineForActivity(routeToFollow).catch(() => {});
      else if (state.location) autoPrepareOfflineForActivity(null).catch(() => {});
      else state.offline.pendingActivityPrepare = true;
    }
  }

  function recordActivityPoint(loc, force = false) {
    if (state.activity.status !== 'recording') return;
    const accuracy = Number(loc.accuracy);
    if (!force && Number.isFinite(accuracy) && accuracy > (getActivityProfile().nativeAccuracy || 40)) return;

    const p = {
      lat: loc.lat,
      lon: loc.lon,
      ele: Number.isFinite(loc.altitude) ? loc.altitude : null,
      time: new Date(loc.timestamp || Date.now()).toISOString(),
      timestamp: loc.timestamp || Date.now(),
      accuracy: Number.isFinite(accuracy) ? accuracy : null
    };
    const prev = state.activity.points[state.activity.points.length - 1];
    if (prev) {
      const d = haversine(prev, p);
      const dt = Math.max(0.5, (p.timestamp - prev.timestamp) / 1000);
      const computedSpeed = (d / dt) * 3600;
      const maxPlausible = getActivityProfile().maxPlausible;
      if (computedSpeed > maxPlausible) return;
      if (!force && d < 0.002 && dt < 8) {
        state.activity.currentSpeed = Number.isFinite(loc.speed) ? loc.speed : computedSpeed;
        updateActivityUI();
        return;
      }
      state.activity.distanceKm += d;
      state.activity.currentSpeed = Number.isFinite(loc.speed) ? Math.max(0, loc.speed) : computedSpeed;
    } else {
      state.activity.currentSpeed = Number.isFinite(loc.speed) ? Math.max(0, loc.speed) : 0;
    }

    state.activity.points.push(p);
    state.activity.line.setLatLngs(state.activity.points.map(x => [x.lat, x.lon]));
    updateActivityUI();
    persistActivitySnapshot();
  }

  function toggleActivityPause() {
    if (state.activity.status === 'recording') {
      state.activity.status = 'paused';
      state.activity.pausedAt = Date.now();
      state.activity.currentSpeed = 0;
      stopNativeActivityLocation();
      toast('Activité en pause.');
    } else if (state.activity.status === 'paused') {
      state.activity.pausedMs += Date.now() - state.activity.pausedAt;
      state.activity.pausedAt = null;
      state.activity.status = 'recording';
      startLocation(false);
      if (state.activity.nativeSessionId) startNativeActivityLocation({ clear:false }).catch(() => {});
      else if (state.location) recordActivityPoint(state.location, true);
      toast('Enregistrement repris.');
    }
    updateActivityUI();
    persistActivitySnapshot(true);
  }

  function finishActivity() {
    if (!['recording','paused'].includes(state.activity.status)) return;
    openFinishActivityModal();
  }

  function openFinishActivityModal() {
    if (!ui.finishActivityModal) return;
    ui.finishActivityModal.classList.remove('hidden');
    document.body.classList.add('activity-choice-open');
    setTimeout(() => ui.finishSaveBtn?.focus(), 30);
  }

  function closeFinishActivityModal() {
    if (!ui.finishActivityModal) return;
    ui.finishActivityModal.classList.add('hidden');
    document.body.classList.remove('activity-choice-open');
  }

  async function finalizeActivity(keepTrack) {
    if (!['recording','paused'].includes(state.activity.status)) {
      closeFinishActivityModal();
      return;
    }

    // Récupère d’abord tous les points enregistrés nativement pendant l’écran éteint,
    // puis arrête le service et sa notification.
    if (state.activity.nativeSessionId) await syncNativeActivityTrack(true);
    await stopNativeActivityLocation();

    if (state.activity.status === 'paused' && state.activity.pausedAt) {
      state.activity.pausedMs += Date.now() - state.activity.pausedAt;
      state.activity.pausedAt = null;
    }

    clearInterval(state.activity.timer);
    state.activity.timer = null;
    state.activity.targetSelect = false;
    state.activity.currentSpeed = 0;
    closeFinishActivityModal();

    if (keepTrack) {
      state.activity.finishedAt = Date.now();
      state.activity.status = 'finished';
      updateActivityUI();
      syncActivityMapPanel();
      setAlert('safe', '🏁', 'Activité terminée', `${state.activity.distanceKm.toFixed(2)} km conservés. Tu peux exporter la trace en GPX.`);
      toast('Activité enregistrée. Trace prête à exporter.');
      persistActivitySnapshot(true);
      return;
    }

    clearActivityTarget();
    clearActivityTrack();
    const previousMode = state.activity.mode;
    state.activity.status = 'idle';
    state.activity.startedAt = null;
    state.activity.pausedAt = null;
    state.activity.pausedMs = 0;
    state.activity.finishedAt = null;
    state.activity.points = [];
    state.activity.distanceKm = 0;
    state.activity.currentSpeed = 0;
    state.activity.name = '';
    state.activity.nativeSessionId = '';
    state.activity.followRoute = null;
    state.activity.followRouteCumKm = null;
    state.activity.followRouteLastIndex = null;
    state.activity.offRouteAlerted = false;
    state.activity.mode = previousMode;
    updateActivityUI();
    syncActivityMapPanel();
    hideRouteFollowGuide();
    setAlert('neutral', '🧭', 'Activité terminée', 'La trace n’a pas été enregistrée.');
    toast('Activité terminée sans enregistrer la trace.');
    clearPersistedActivity();
  }

  function clearActivityTrack() {
    if (state.activity.line) state.map.removeLayer(state.activity.line);
    state.activity.line = null;
    if (state.activity.routeProgressMarker) state.map.removeLayer(state.activity.routeProgressMarker);
    state.activity.routeProgressMarker = null;
  }

  function activityElapsedMs() {
    if (!state.activity.startedAt) return 0;
    const end = state.activity.status === 'finished' ? (state.activity.finishedAt || Date.now()) : Date.now();
    const currentPause = state.activity.status === 'paused' && state.activity.pausedAt ? end - state.activity.pausedAt : 0;
    return Math.max(0, end - state.activity.startedAt - state.activity.pausedMs - currentPause);
  }

  function syncActivityModeButtons() {
    const mode = ACTIVITY_PROFILES[state.activity.mode] ? state.activity.mode : 'hike';
    const locked = ['recording','paused'].includes(state.activity.status);
    document.querySelectorAll('[data-activity-mode]').forEach(btn => {
      const active = btn.dataset.activityMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('activity-mode-locked', locked && !active);
    });
  }

  function updateActivityUI() {
    const a = state.activity;
    // Toujours resynchroniser le sélecteur visuel avec l'état réel.
    // Important après restauration d'une activité (pull-to-refresh/rechargement).
    syncActivityModeButtons();
    if (a.status === 'idle') {
      ui.activityTitle.textContent = 'Nouvelle activité';
      ui.activityStartBtn.textContent = '▶ Démarrer';
      ui.activityExportBtn.classList.add('hidden');
      ui.activityStats.classList.add('hidden');
      ui.activityHelp.textContent = 'Choisis randonnée, vélo route, gravel ou VTT, puis démarre. La trace sera dessinée en direct sur la carte.';
      hideRouteFollowGuide();
      syncActivityMapPanel();
      return;
    }

    const elapsed = activityElapsedMs();
    const hours = elapsed / 3600000;
    const avg = hours > 0 ? a.distanceKm / hours : 0;
    const distance = `${a.distanceKm.toFixed(2).replace('.', ',')} km`;
    const time = formatDuration(elapsed);
    const speed = `${Math.max(0, a.currentSpeed || 0).toFixed(1).replace('.', ',')} km/h`;
    const avgSpeed = `${Math.max(0, avg).toFixed(1).replace('.', ',')} km/h`;

    const activityProfile = getActivityProfile(a.mode);
    ui.activityTitle.textContent = a.status === 'finished' ? a.name : `${activityProfile.label} en cours`;
    ui.activityDistance.textContent = distance;
    ui.activityTime.textContent = time;
    ui.activitySpeed.textContent = speed;
    ui.activityAvgSpeed.textContent = avgSpeed;
    ui.activityStats.classList.remove('hidden');

    if (a.status === 'finished') {
      ui.activityStartBtn.textContent = '▶ Nouvelle activité';
      ui.activityExportBtn.classList.toggle('hidden', a.points.length < 2);
      ui.activityHelp.textContent = a.followRoute
        ? `Parcours suivi : ${a.followRoute.name}. Activité terminée, tu peux exporter ta trace réelle en GPX.`
        : 'Activité terminée. Exporte le GPX pour la conserver ou l’envoyer vers Garmin Connect.';
    } else {
      ui.activityStartBtn.textContent = '🗺️ Ouvrir la carte';
      ui.activityExportBtn.classList.add('hidden');
      ui.activityHelp.textContent = a.status === 'paused'
        ? 'Activité en pause.'
        : (a.followRoute ? `Suivi du GPX « ${a.followRoute.name} » en cours.` : 'Enregistrement GPS en cours. Le déplacement de la carte ne coupe pas le suivi.');
    }

    ui.activityMapTitle.textContent = `${activityProfile.icon} ${activityProfile.label}`;
    ui.activityMapStatus.textContent = a.status === 'finished'
      ? 'TERMINÉE'
      : a.status === 'paused'
        ? 'EN PAUSE'
        : (state.nativeGps.active
            ? `GPS NATIF · ${state.nativeGps.pointCount || a.points.length || 0} pts · écran éteint`
            : 'GPS · enregistrement');
    ui.activityMapDistance.textContent = distance;
    ui.activityMapTime.textContent = time;
    ui.activityMapSpeed.textContent = speed;
    ui.activityPauseBtn.textContent = a.status === 'paused' ? '▶' : '⏸';
    ui.activityPauseBtn.setAttribute('aria-label', a.status === 'paused' ? 'Reprendre' : 'Mettre en pause');
    syncActivityMapPanel();
    if (a.followRoute && state.location) updateRouteFollowGuide(state.location);
    else if (!a.followRoute) hideRouteFollowGuide();
    if (a.target) updateTargetGuide();
  }

  function activityMainButton() {
    if (state.activity.status === 'idle' || state.activity.status === 'finished') {
      startActivity();
      return;
    }
    showAppScreen('map', { scroll: false });
    setTimeout(() => enterMapFullscreen(), 60);
  }

  function exportActivity() {
    if (state.activity.points.length < 2) return;
    downloadGpx(state.activity.name || 'Activité', state.activity.points, 'activity', getActivityProfile().label);
  }

  function setActivityPanelCollapsed(collapsed) {
    if (!ui.activityMapPanel) return;
    ui.activityMapPanel.classList.toggle('collapsed', !!collapsed);
    ui.mapWrap?.classList.toggle('activity-panel-collapsed', !!collapsed);
    if (ui.activityPanelToggle) {
      ui.activityPanelToggle.textContent = collapsed ? '⌃' : '⌄';
      ui.activityPanelToggle.setAttribute('aria-label', collapsed ? 'Agrandir le panneau d’activité' : 'Réduire le panneau d’activité');
      ui.activityPanelToggle.setAttribute('title', collapsed ? 'Agrandir' : 'Réduire');
    }
  }

  function toggleActivityPanel() {
    if (!ui.activityMapPanel) return;
    setActivityPanelCollapsed(!ui.activityMapPanel.classList.contains('collapsed'));
  }

  function syncActivityMapPanel() {
    const active = ['recording','paused'].includes(state.activity.status);
    const shouldShow = active && state.mapFullscreen;
    const wasHidden = ui.activityMapPanel.classList.contains('hidden');
    ui.activityMapPanel.classList.toggle('hidden', !shouldShow);
    ui.mapWrap.classList.toggle('activity-active', shouldShow);
    if (shouldShow) {
      // À chaque ouverture de la carte pendant une activité, on démarre compact
      // pour laisser le maximum de carte visible. L’utilisateur peut agrandir d’un tap.
      if (wasHidden) setActivityPanelCollapsed(true);
      else ui.mapWrap.classList.toggle('activity-panel-collapsed', ui.activityMapPanel.classList.contains('collapsed'));
    } else {
      ui.mapWrap.classList.remove('activity-panel-collapsed');
      hideRouteFollowGuide();
    }
  }

  function updateRouteFollowGuide(loc) {
    const route = state.activity.followRoute;
    const cum = state.activity.followRouteCumKm;
    if (!route || !cum || !loc || !route.points?.length) {
      ui.routeFollowGuide?.classList.add('hidden');
      return;
    }

    let bestIndex = 0;
    let bestKm = Infinity;
    for (let i = 0; i < route.points.length; i++) {
      const d = haversine(loc, route.points[i]);
      if (d < bestKm) {
        bestKm = d;
        bestIndex = i;
      }
    }

    state.activity.followRouteLastIndex = bestIndex;
    const travelledOnRoute = cum[bestIndex] || 0;
    const total = route.distanceKm || cum[cum.length - 1] || 0;
    const remaining = Math.max(0, total - travelledOnRoute);
    const progress = total > 0 ? Math.min(100, Math.max(0, travelledOnRoute / total * 100)) : 0;
    const deviationM = Math.round(bestKm * 1000);
    const threshold = getActivityProfile(state.activity.mode).offRouteM;

    // Point rouge = progression réelle projetée sur le parcours suivi.
    const rp = route.points[bestIndex];
    if (rp && Number.isFinite(Number(rp.lat)) && Number.isFinite(Number(rp.lon))) {
      const rll = [Number(rp.lat), Number(rp.lon)];
      if (!state.activity.routeProgressMarker) {
        state.activity.routeProgressMarker = L.marker(rll, { icon:redMapPointIcon(), zIndexOffset:1200, interactive:false }).addTo(state.map);
      } else state.activity.routeProgressMarker.setLatLng(rll);
      const altTxt = hasElevation(rp.ele) ? ` · ${Math.round(Number(rp.ele))} m` : '';
      state.activity.routeProgressMarker.bindTooltip(`${Math.round(progress)} %${altTxt}`, { direction:'top', offset:[0,-8] });
      state.activity.routeProgressMarker.bringToFront?.();
    }

    ui.routeFollowGuide.classList.remove('hidden');
    ui.routeFollowName.textContent = route.name || 'Parcours';
    ui.routeFollowRemaining.textContent = `${remaining.toFixed(1).replace('.', ',')} km`;
    ui.routeFollowProgress.textContent = `${Math.round(progress)} %`;
    ui.routeFollowDeviation.textContent = `${deviationM} m`;
    updateElevationChartProgress('current-route', progress / 100);
    ui.routeFollowGuide.classList.toggle('off-route', deviationM > threshold);

    if (deviationM > threshold && !state.activity.offRouteAlerted) {
      state.activity.offRouteAlerted = true;
      toast(`⚠️ Tu es à environ ${deviationM} m du tracé GPX.`);
    } else if (deviationM <= Math.round(threshold * 0.65)) {
      state.activity.offRouteAlerted = false;
    }

    if (remaining < 0.05 && deviationM < threshold) {
      ui.routeFollowRemaining.textContent = 'Arrivée';
    }
  }

  function hideRouteFollowGuide() {
    ui.routeFollowGuide?.classList.add('hidden');
  }

  // ---------- Navigation vers un point ----------

  function beginTargetSelection() {
    if (!['recording','paused'].includes(state.activity.status)) {
      toast('Démarre d’abord une activité.');
      return;
    }
    state.activity.targetSelect = true;
    ui.targetSelectBtn.classList.add('selecting');
    ui.targetSelectBtn.textContent = '👆 Touchez la carte';
    toast('Touchez maintenant le point à rejoindre sur la carte.');
  }

  function setActivityTarget(point) {
    state.activity.targetSelect = false;
    ui.targetSelectBtn.classList.remove('selecting');
    ui.targetSelectBtn.textContent = '🎯 Destination';
    clearActivityTarget(false);
    state.activity.target = point;
    const icon = L.divIcon({ className:'', html:'<div class="target-marker">🎯</div>', iconSize:[34,34], iconAnchor:[17,17] });
    state.activity.targetMarker = L.marker([point.lat, point.lon], { icon, zIndexOffset: 900 }).addTo(state.map);
    state.activity.targetLine = L.polyline([], { color:'#fbbf24', weight:3, opacity:.9, dashArray:'7 8' }).addTo(state.map);
    ui.targetGuide.classList.remove('hidden');
    updateTargetGuide();
    toast('Destination définie. Guidage activé.');
    persistActivitySnapshot(true);
  }

  function clearActivityTarget(clearPoint = true) {
    if (state.activity.targetMarker) state.map.removeLayer(state.activity.targetMarker);
    if (state.activity.targetLine) state.map.removeLayer(state.activity.targetLine);
    state.activity.targetMarker = null;
    state.activity.targetLine = null;
    if (clearPoint) state.activity.target = null;
    ui.targetGuide.classList.add('hidden');
    state.activity.targetSelect = false;
    ui.targetSelectBtn.classList.remove('selecting');
    ui.targetSelectBtn.textContent = '🎯 Destination';
    if (clearPoint) persistActivitySnapshot(true);
  }

  function updateTargetGuide() {
    const a = state.activity;
    if (!a.target || !state.location) return;
    const from = state.location;
    const distanceKm = haversine(from, a.target);
    const bearing = initialBearing(from, a.target);
    const heading = Number.isFinite(from.heading) ? from.heading : null;
    const relative = heading == null ? null : normalizeSignedAngle(bearing - heading);
    const navSpeed = a.currentSpeed >= 1 ? a.currentSpeed : getActivityProfile(a.mode).navSpeed;
    const etaMs = (distanceKm / Math.max(navSpeed, 0.5)) * 3600000;

    ui.targetDistance.textContent = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(2).replace('.', ',')} km`;
    const turn = relative == null ? '' : ` · ${relativeDirection(relative)}`;
    ui.targetBearing.textContent = `Cap ${Math.round(bearing)}° ${cardinal(bearing)}${turn}`;
    ui.targetEta.textContent = formatEta(etaMs);
    ui.targetArrow.style.transform = `rotate(${relative == null ? bearing : relative}deg)`;
    ui.targetGuide.classList.remove('hidden');
    if (a.targetLine) a.targetLine.setLatLngs([[from.lat, from.lon], [a.target.lat, a.target.lon]]);

    if (distanceKm < 0.03) {
      ui.targetDistance.textContent = 'ARRIVÉ';
      ui.targetEta.textContent = '✓';
    }
  }

  // ---------- Outils ----------

  function sampleRoute(points, count) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i-1] + haversine(points[i-1], points[i]));
    const total = cum[cum.length - 1];
    const out = [];
    for (let k = 0; k < count; k++) {
      const target = (total * k) / (count - 1);
      let idx = 0;
      while (idx < cum.length - 1 && cum[idx] < target) idx++;
      out.push({ point: points[idx], distanceKm: cum[idx] });
    }
    return out;
  }

  function nearestTimeIndex(times, date) {
    if (!times.length) return 0;
    let best = 0, bestDiff = Infinity;
    const target = date.getTime();
    times.forEach((t, i) => {
      const d = Math.abs(new Date(t).getTime() - target);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    return best;
  }

  function riskFor(precip = 0, gust = 0, code = 0) {
    precip = Number(precip || 0); gust = Number(gust || 0); code = Number(code || 0);
    let score = 0, emoji = '✅';
    if (precip >= 0.5 || gust >= 40 || code >= 61) { score = 1; emoji = '🟡'; }
    if (precip >= 2 || gust >= 55 || [65,67,82,95,96,99].includes(code)) { score = 2; emoji = '🟠'; }
    if (precip >= 5 || gust >= 70 || [96,99].includes(code)) { score = 3; emoji = '🔴'; }
    return { score, emoji };
  }

  function routeDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += haversine(points[i-1], points[i]);
    return total;
  }

  function haversine(a, b) {
    const R = 6371;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function initialBearing(a, b) {
    const lat1 = rad(a.lat), lat2 = rad(b.lat), dLon = rad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function normalizeSignedAngle(deg) {
    return ((deg + 540) % 360) - 180;
  }

  function relativeDirection(angle) {
    const a = Math.abs(angle);
    if (a < 15) return 'tout droit';
    if (a > 165) return 'demi-tour';
    return `${angle > 0 ? 'droite' : 'gauche'} ${Math.round(a)}°`;
  }

  function cardinal(deg) {
    const dirs = ['N','NE','E','SE','S','SO','O','NO'];
    return dirs[Math.round(deg / 45) % 8];
  }

  function downsamplePreserve(points, maxPoints) {
    if (points.length <= maxPoints) return points.map(p => ({...p}));
    const out = [];
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round((i * (points.length - 1)) / (maxPoints - 1));
      out.push({...points[idx]});
    }
    return out;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '--';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${Math.max(1, mins)} min`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${h}h${String(m).padStart(2,'0')}`;
  }

  function downloadGpx(name, points, type = 'route', activityType = '') {
    const safeName = (name || 'Rando Radar').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Rando-Radar';
    const trkpts = points.map(p => {
      const ele = Number.isFinite(Number(p.ele)) ? `<ele>${Number(p.ele).toFixed(1)}</ele>` : '';
      const time = p.time ? `<time>${new Date(p.time).toISOString()}</time>` : '';
      return `      <trkpt lat="${Number(p.lat).toFixed(7)}" lon="${Number(p.lon).toFixed(7)}">${ele}${time}</trkpt>`;
    }).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rando Radar" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xmlEscape(name || safeName)}</name></metadata>\n  <trk><name>${xmlEscape(name || safeName)}</name><type>${xmlEscape(type === 'activity' ? (activityType || 'activity') : 'route')}</type><trkseg>\n${trkpts}\n  </trkseg></trk>\n</gpx>`;
    const blob = new Blob([gpx], { type:'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const rad = d => d * Math.PI / 180;
  const number = (v, digits = 0, fallback = '--') => Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : fallback;
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const xmlEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

  function weatherEmoji(code) {
    code = Number(code);
    if (code === 0) return '☀️';
    if ([1,2].includes(code)) return '🌤️';
    if (code === 3) return '☁️';
    if ([45,48].includes(code)) return '🌫️';
    if ([51,53,55,56,57].includes(code)) return '🌦️';
    if ([61,63,65,66,67,80,81,82].includes(code)) return '🌧️';
    if ([71,73,75,77,85,86].includes(code)) return '🌨️';
    if ([95,96,99].includes(code)) return '⛈️';
    return '🌤️';
  }

  function weatherText(code) {
    code = Number(code);
    if (code === 0) return 'Ciel clair';
    if ([1,2].includes(code)) return 'Peu nuageux';
    if (code === 3) return 'Couvert';
    if ([45,48].includes(code)) return 'Brouillard';
    if ([51,53,55,56,57].includes(code)) return 'Bruine';
    if ([61,63,65,66,67].includes(code)) return 'Pluie';
    if ([80,81,82].includes(code)) return 'Averses';
    if ([71,73,75,77,85,86].includes(code)) return 'Neige';
    if ([95,96,99].includes(code)) return 'Orage';
    return 'Variable';
  }

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => ui.toast.classList.remove('show'), 2600);
  }

  const APP_SCREEN_NAMES = new Set(['map','activity','routes','weather','info']);
  let currentAppScreen = 'map';

  // V1.10.16 : le pull-to-refresh Android/Chrome est autorisé uniquement
  // sur l'écran Infos (où la version chargée est visible).
  function updatePullToRefreshPolicy(screenName) {
    const allow = screenName === 'info';
    document.documentElement.classList.toggle('pull-refresh-allowed', allow);
    document.body.classList.toggle('pull-refresh-allowed', allow);
    document.documentElement.classList.toggle('pull-refresh-locked', !allow);
    document.body.classList.toggle('pull-refresh-locked', !allow);
  }

  // V1.10.16 : bloque uniquement le geste descendant depuis le haut de page.
  // Le scroll vertical normal reste intact.
  let pullGestureStartY = null;
  let pullGestureStartedAtTop = false;
  let pullGestureTarget = null;

  function isInsideOwnScrollableArea(target) {
    return !!target?.closest?.('.activity-map-panel, .finder-map-detail, .hike-finder-map-results, .hourly-scroll, #map');
  }

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) {
      pullGestureStartY = null;
      return;
    }
    pullGestureStartY = event.touches[0].clientY;
    pullGestureStartedAtTop = window.scrollY <= 1;
    pullGestureTarget = event.target;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (currentAppScreen === 'info') return;
    if (pullGestureStartY == null || !pullGestureStartedAtTop || event.touches.length !== 1) return;
    if (isInsideOwnScrollableArea(pullGestureTarget)) return;

    const deltaY = event.touches[0].clientY - pullGestureStartY;
    // Doigt vers le bas + page déjà en butée haute = geste de rafraîchissement.
    // Doigt vers le haut = scroll normal, jamais bloqué.
    if (deltaY > 10 && window.scrollY <= 1) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    pullGestureStartY = null;
    pullGestureStartedAtTop = false;
    pullGestureTarget = null;
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    pullGestureStartY = null;
    pullGestureStartedAtTop = false;
    pullGestureTarget = null;
  }, { passive: true });

  function showAppScreen(name, options = {}) {
    if (!APP_SCREEN_NAMES.has(name)) name = 'map';
    const { scroll = true } = options;
    currentAppScreen = name;
    updatePullToRefreshPolicy(name);

    document.querySelectorAll('.app-screen[data-screen]').forEach(screen => {
      const active = screen.dataset.screen === name;
      screen.classList.toggle('active', active);
      screen.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    document.querySelectorAll('[data-nav]').forEach(btn => {
      const active = btn.dataset.nav === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });

    if (name === 'activity') openActivityCard();
    if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });

    // Leaflet a besoin de recalculer sa taille après avoir été masqué.
    if (name === 'map') {
      setTimeout(() => {
        state.map?.invalidateSize();
        if (state.location && !state.mapFullscreen) {
          // On ne recentre pas : on conserve la position de carte choisie par l'utilisateur.
        }
      }, 60);
    }
  }


  // ---------- Cartes hors ligne v1.9.1 ----------
  const OFFLINE_DB_NAME = 'randoRadar.offline.v1';
  const OFFLINE_STORE = 'areas';

  function formatOfflineDate(ts) {
    if (!ts) return '--';
    try { return new Date(ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch (_) { return '--'; }
  }

  function openOfflineDB() {
    if (state.offline.db) return Promise.resolve(state.offline.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(OFFLINE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => { state.offline.db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error || new Error('Stockage hors ligne indisponible'));
    });
  }

  async function offlineDbGetAll() {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a,b) => (b.createdAt||0)-(a.createdAt||0)));
      req.onerror = () => reject(req.error);
    });
  }

  async function offlineDbPut(item) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error || new Error('Enregistrement impossible'));
    });
  }

  async function offlineDbDelete(id) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function setOfflineProgress(show, title = 'Préparation…', text = '') {
    if (!offlineUI.progress) return;
    offlineUI.progress.classList.toggle('hidden', !show);
    if (offlineUI.progressTitle) offlineUI.progressTitle.textContent = title;
    if (offlineUI.progressText) offlineUI.progressText.textContent = text;
  }

  function updateOfflineNetworkBadge() {
    if (!offlineUI.networkBadge) return;
    const off = !navigator.onLine || !!state.offline.activePackage;
    offlineUI.networkBadge.textContent = off ? '📴 Hors ligne' : '🌐 En ligne';
    offlineUI.networkBadge.classList.toggle('offline', off);
    offlineUI.backOnlineBtn?.classList.toggle('hidden', !state.offline.activePackage || !navigator.onLine);
  }

  function routeSamplesForOffline(points, bufferKm) {
    const valid = (points || []).filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
    if (valid.length <= 2) return valid;
    const total = routeDistance(valid);
    const spacing = Math.max(.8, Math.max(bufferKm * 1.35, total / 16));
    const out = [valid[0]];
    let acc = 0, target = spacing;
    for (let i=1; i<valid.length; i++) {
      acc += haversine(valid[i-1], valid[i]);
      if (acc >= target) { out.push(valid[i]); target += spacing; }
    }
    const last = valid[valid.length-1];
    if (out[out.length-1] !== last) out.push(last);
    if (out.length > 18) {
      const step = (out.length - 1) / 17;
      return Array.from({length:18}, (_,i) => out[Math.round(i*step)]);
    }
    return out;
  }

  function buildOfflineOverpassQuery(points, radiusM) {
    const safePoints = points.slice(0,18);
    const selectors = [];
    for (const p of safePoints) {
      const at = `${radiusM},${Number(p.lat).toFixed(6)},${Number(p.lon).toFixed(6)}`;
      selectors.push(`way(around:${at})["highway"];`);
      selectors.push(`way(around:${at})["waterway"];`);
      selectors.push(`way(around:${at})["natural"="water"];`);
      selectors.push(`way(around:${at})["landuse"~"^(forest|meadow|grass|farmland|orchard)$"];`);
      selectors.push(`way(around:${at})["leisure"="nature_reserve"];`);
      selectors.push(`node(around:${at})["place"~"^(village|hamlet|locality)$"];`);
      selectors.push(`node(around:${at})["tourism"~"^(alpine_hut|wilderness_hut|viewpoint|information)$"];`);
      selectors.push(`node(around:${at})["amenity"~"^(drinking_water|parking|shelter)$"];`);
    }
    return `[out:json][timeout:65];(${selectors.join('')});out body geom qt;`;
  }


  async function fetchOfflineElementsSegmented(samples, radiusM) {
    const merged = new Map();
    const chunks = [];
    for (let i=0; i<samples.length; i+=4) chunks.push(samples.slice(i,i+4));
    for (let i=0; i<chunks.length; i++) {
      setOfflineProgress(true, 'Téléchargement de la carte…', `Zone ${i+1} sur ${chunks.length} le long du parcours.`);
      const data = await fetchOverpass(buildOfflineOverpassQuery(chunks[i], radiusM), 62000);
      for (const el of data.elements || []) merged.set(`${el.type}:${el.id}`, el);
    }
    return { elements:[...merged.values()] };
  }

  function thinOfflineGeometry(geom) {
    const pts = (geom || []).map(g => [Number(g.lat), Number(g.lon)]).filter(a => Number.isFinite(a[0]) && Number.isFinite(a[1]));
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let last = { lat: pts[0][0], lon: pts[0][1] };
    for (let i=1; i<pts.length-1; i++) {
      const p = { lat: pts[i][0], lon: pts[i][1] };
      if (haversine(last, p) >= .012) { out.push(pts[i]); last = p; }
    }
    out.push(pts[pts.length-1]);
    return out;
  }

  function compactOfflineElements(data) {
    const out = [];
    const seen = new Set();
    for (const el of data.elements || []) {
      const key = `${el.type}:${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tags = el.tags || {};
      if (el.type === 'way' && Array.isArray(el.geometry)) {
        const geometry = thinOfflineGeometry(el.geometry);
        if (geometry.length < 2) continue;
        const keepTags = {};
        for (const k of ['name','ref','highway','surface','tracktype','waterway','natural','landuse','leisure','bicycle','foot','access']) if (tags[k] != null) keepTags[k] = tags[k];
        out.push({ type:'way', id:Number(el.id), geometry, tags:keepTags });
      } else if (el.type === 'node' && Number.isFinite(Number(el.lat)) && Number.isFinite(Number(el.lon))) {
        const keepTags = {};
        for (const k of ['name','place','tourism','amenity','ref']) if (tags[k] != null) keepTags[k] = tags[k];
        out.push({ type:'node', id:Number(el.id), lat:Number(el.lat), lon:Number(el.lon), tags:keepTags });
      }
    }
    return out;
  }

  function offlineBoundsFromData(features, route) {
    let south=90, west=180, north=-90, east=-180;
    const add=(lat,lon)=>{ if(!Number.isFinite(lat)||!Number.isFinite(lon)) return; south=Math.min(south,lat); north=Math.max(north,lat); west=Math.min(west,lon); east=Math.max(east,lon); };
    for (const f of features || []) {
      if (f.type === 'node') add(f.lat,f.lon);
      else for (const pt of f.geometry || []) add(pt[0],pt[1]);
    }
    for (const p of route?.points || []) add(Number(p.lat),Number(p.lon));
    return south <= north ? [south,west,north,east] : null;
  }

  function offlineFeatureClass(tags={}) {
    if (tags.natural === 'water') return 'water';
    if (tags.landuse || tags.leisure === 'nature_reserve') return 'land';
    if (tags.waterway) return 'waterway';
    const hw = String(tags.highway || '');
    if (['motorway','trunk','primary','secondary','tertiary'].includes(hw)) return 'major-road';
    if (['residential','unclassified','service','living_street','road'].includes(hw)) return 'road';
    if (['cycleway'].includes(hw)) return 'cycleway';
    if (['track'].includes(hw)) return 'track';
    if (['path','footway','bridleway','steps','pedestrian'].includes(hw)) return 'trail';
    return 'other';
  }

  function offlineStyleFor(feature) {
    const cls = offlineFeatureClass(feature.tags);
    if (cls === 'water') return { color:'#8abbd9', weight:1, fillColor:'#b9ddec', fillOpacity:.72 };
    if (cls === 'land') return { color:'#b7cbb3', weight:.6, fillColor:'#dfead8', fillOpacity:.55 };
    if (cls === 'waterway') return { color:'#65a9d2', weight:1.8, opacity:.85 };
    if (cls === 'major-road') return { color:'#7c8791', weight:3.2, opacity:.9 };
    if (cls === 'road') return { color:'#9aa3aa', weight:2.2, opacity:.85 };
    if (cls === 'cycleway') return { color:'#4b8f79', weight:2.4, opacity:.9, dashArray:'7 4' };
    if (cls === 'track') return { color:'#92724f', weight:2, opacity:.86, dashArray:'6 5' };
    if (cls === 'trail') return { color:'#7a6e61', weight:1.7, opacity:.82, dashArray:'3 5' };
    return { color:'#b0b5b8', weight:1.2, opacity:.65 };
  }

  function drawOfflinePackage(pkg, fit = true) {
    if (!pkg) return;
    if (state.offline.layerGroup) state.map.removeLayer(state.offline.layerGroup);
    const group = L.layerGroup().addTo(state.map);
    state.offline.layerGroup = group;

    const features = pkg.features || [];
    // Les surfaces d'abord pour que routes et sentiers restent lisibles.
    const sorted = features.slice().sort((a,b) => {
      const rank = f => f.type === 'node' ? 3 : (['water','land'].includes(offlineFeatureClass(f.tags)) ? 0 : 1);
      return rank(a)-rank(b);
    });
    for (const f of sorted) {
      if (f.type === 'way') {
        const cls = offlineFeatureClass(f.tags);
        const latlngs = f.geometry;
        let layer;
        const closed = latlngs.length > 2 && Math.abs(latlngs[0][0]-latlngs[latlngs.length-1][0]) < 1e-7 && Math.abs(latlngs[0][1]-latlngs[latlngs.length-1][1]) < 1e-7;
        if (closed && ['water','land'].includes(cls)) layer = L.polygon(latlngs, offlineStyleFor(f));
        else layer = L.polyline(latlngs, offlineStyleFor(f));
        const name = f.tags?.name || f.tags?.ref;
        if (name) layer.bindTooltip(escapeHtml(name), { sticky:true, className:'offline-map-label', direction:'top' });
        layer.addTo(group);
      } else if (f.type === 'node') {
        const t = f.tags || {};
        const name = t.name || ({drinking_water:'Eau potable',parking:'Parking',shelter:'Abri'})[t.amenity] || ({alpine_hut:'Refuge',wilderness_hut:'Abri',viewpoint:'Point de vue'})[t.tourism] || t.place;
        if (t.place && name) {
          const icon = L.divIcon({ className:'', html:`<div class="offline-place-label">${escapeHtml(name)}</div>`, iconSize:[100,20], iconAnchor:[50,10] });
          L.marker([f.lat,f.lon], { icon, interactive:false, zIndexOffset:250 }).addTo(group);
        } else {
          const symbol = t.amenity === 'drinking_water' ? '💧' : t.amenity === 'parking' ? '🅿️' : (t.tourism?.includes('hut') ? '🏠' : t.tourism === 'viewpoint' ? '👁️' : '•');
          const marker = L.circleMarker([f.lat,f.lon], { radius:4.5, color:'#526474', weight:1, fillColor:'#fff', fillOpacity:.95 });
          if (name) marker.bindTooltip(`${symbol} ${escapeHtml(name)}`, { direction:'top', className:'offline-map-label' });
          marker.addTo(group);
        }
      }
    }
    state.routeLine?.bringToFront?.();
    state.activity.line?.bringToFront?.();
    if (fit && pkg.bbox) state.map.fitBounds([[pkg.bbox[0],pkg.bbox[1]],[pkg.bbox[2],pkg.bbox[3]]], { padding:[22,22] });
  }

  function freezeOnlineBaseForOffline() {
    // On conserve la couche raster déjà affichée : les tuiles présentes à l'écran
    // et celles encore en cache navigateur restent visibles. La carte vectorielle
    // locale est dessinée par-dessus. On désactive seulement le changement de fond.
    document.querySelectorAll('[data-basemap]').forEach(btn => btn.disabled = true);
  }

  function setAutoOfflineBadge(mode, text = '') {
    let badge = document.getElementById('autoOfflineBadge');
    if (!mode) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'autoOfflineBadge';
      badge.className = 'offline-status-map auto-offline-badge';
      ui.mapWrap.appendChild(badge);
    }
    badge.classList.toggle('ready', mode === 'ready');
    badge.classList.toggle('partial', mode === 'partial');
    badge.textContent = text || (mode === 'preparing' ? '⬇️ Carte secours en préparation…' : mode === 'ready' ? '✓ Carte secours prête' : '⚠️ Carte secours partielle');
  }

  function setOnlineBaseVisible(visible) {
    for (const layer of Object.values(state.baseLayers)) if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
    if (visible && state.baseLayers[state.activeBase]) state.baseLayers[state.activeBase].addTo(state.map);
    document.querySelectorAll('[data-basemap]').forEach(btn => btn.disabled = !visible);
  }

  function setOfflineMapStatusVisible(visible) {
    let badge = document.getElementById('offlineMapStatus');
    if (visible && !badge) {
      badge = document.createElement('div'); badge.id='offlineMapStatus'; badge.className='offline-status-map'; badge.textContent='📴 Carte hors ligne';
      ui.mapWrap.appendChild(badge);
    } else if (!visible && badge) badge.remove();
  }

  function activateOfflinePackage(pkg, { fit = true, forced = true } = {}) {
    if (!pkg) return;
    state.offline.activePackage = pkg;
    state.offline.forced = forced;
    freezeOnlineBaseForOffline();
    if (state.radarLayer && state.map.hasLayer(state.radarLayer)) state.map.removeLayer(state.radarLayer);
    ui.radarPanel.classList.add('hidden');
    ui.radarToggle.classList.remove('active');
    ui.radarTime.textContent = 'Radar hors ligne';
    document.getElementById('map')?.classList.add('offline-vector-map');
    drawOfflinePackage(pkg, fit);
    setOfflineMapStatusVisible(true);
    if (!state.offline.attributionAdded && state.map.attributionControl) {
      state.map.attributionControl.addAttribution('Carte hors ligne © OpenStreetMap contributors');
      state.offline.attributionAdded = true;
    }
    if (offlineUI.current && offlineUI.currentName) {
      offlineUI.current.classList.remove('hidden'); offlineUI.currentName.textContent = pkg.name || 'Carte locale';
    }
    if (pkg.route?.points?.length && (!state.route || state.route.name !== pkg.route.name)) {
      state.route = JSON.parse(JSON.stringify(pkg.route));
      drawRoute(false);
      renderRouteStats();
    }
    state.routeLine?.bringToFront?.();
    state.activity.line?.bringToFront?.();
    if (pkg.weather) {
      state.lastWeather = pkg.weather;
      renderCurrentWeather(pkg.weather); renderHourly(pkg.weather);
      if (ui.weatherUpdatedAt) ui.weatherUpdatedAt.textContent = `Météo enregistrée : ${formatOfflineDate(pkg.weatherSavedAt)}`;
    }
    updateOfflineNetworkBadge();
  }

  function deactivateOfflineMap({ restoreOnline = true } = {}) {
    if (state.offline.layerGroup) state.map.removeLayer(state.offline.layerGroup);
    state.offline.layerGroup = null;
    state.offline.activePackage = null;
    state.offline.forced = false;
    document.getElementById('map')?.classList.remove('offline-vector-map');
    setOfflineMapStatusVisible(false);
    if (state.offline.attributionAdded && state.map.attributionControl) {
      state.map.attributionControl.removeAttribution('Carte hors ligne © OpenStreetMap contributors');
      state.offline.attributionAdded = false;
    }
    if (offlineUI.current) offlineUI.current.classList.add('hidden');
    if (restoreOnline && navigator.onLine) {
      setOnlineBaseVisible(true);
      ui.radarPanel.classList.toggle('hidden', !state.radarEnabled);
      ui.radarToggle.classList.toggle('active', state.radarEnabled);
      loadRadar();
    }
    updateOfflineNetworkBadge();
  }

  function bboxContains(bbox, p) {
    return !!bbox && !!p && p.lat >= bbox[0] && p.lat <= bbox[2] && p.lon >= bbox[1] && p.lon <= bbox[3];
  }

  async function chooseOfflinePackageForCurrentPosition() {
    try {
      const list = await offlineDbGetAll();
      if (!list.length) return null;
      const p = state.location;
      return (p && list.find(x => bboxContains(x.bbox,p))) || (state.route && list.find(x => x.route?.name === state.route.name)) || list[0];
    } catch (_) { return null; }
  }

  async function handleOfflineNetworkLoss() {
    updateOfflineNetworkBadge();
    if (state.offline.activePackage) return;
    const pkg = await chooseOfflinePackageForCurrentPosition();
    if (pkg) {
      activateOfflinePackage(pkg, { fit:false, forced:false });
      toast(`Mode hors ligne : ${pkg.name}`);
    } else {
      // Ne pas effacer brutalement la carte déjà à l'écran : les tuiles déjà
      // chargées/cachées peuvent rester visibles même sans réseau.
      freezeOnlineBaseForOffline();
      setOfflineMapStatusVisible(true);
      ui.radarPanel.classList.add('hidden');
      toast('Hors ligne : carte locale pas encore prête. Les tuiles déjà chargées restent affichées.');
    }
  }

  async function handleOnlineReturn() {
    updateOfflineNetworkBadge();
    if (state.offline.activePackage && state.offline.forced) return;
    deactivateOfflineMap({ restoreOnline:true });
    toast('Connexion retrouvée : carte en ligne réactivée.');
  }

  function offlineFeatureSummary(features) {
    let roads=0,trails=0,water=0,pois=0;
    for (const f of features || []) {
      if (f.type === 'node') { pois++; continue; }
      const c=offlineFeatureClass(f.tags); if (['major-road','road','cycleway'].includes(c)) roads++; else if (['track','trail'].includes(c)) trails++; else if (['water','waterway'].includes(c)) water++;
    }
    return `${roads} routes · ${trails} sentiers/pistes · ${water} éléments d’eau · ${pois} points utiles`;
  }

  async function existingOfflinePackageFor(route, loc) {
    try {
      const list = await offlineDbGetAll();
      if (route?.points?.length) {
        // Une carte est considérée comme suffisante si elle couvre tout le tracé.
        return list.find(pkg => pkg.bbox && route.points.every(p => bboxContains(pkg.bbox, p))) || null;
      }
      if (loc) return list.find(pkg => bboxContains(pkg.bbox, loc)) || null;
    } catch (_) {}
    return null;
  }

  async function createOfflinePackage({ route = null, loc = null, bufferKm = 3, automatic = false } = {}) {
    if (state.offline.preparing) return null;
    if (!navigator.onLine) return null;

    bufferKm = Math.max(1, Math.min(5, Number(bufferKm || 3)));
    let samples = [], name = '', source = route ? 'route' : 'position';

    if (route?.points?.length) {
      route = JSON.parse(JSON.stringify(route));
      samples = routeSamplesForOffline(route.points, bufferKm);
      name = `🗺️ ${route.name}`;
    } else {
      loc = loc || state.location;
      if (!loc) return null;
      samples = [{ lat:Number(loc.lat), lon:Number(loc.lon) }];
      name = `📍 Zone ${Number(loc.lat).toFixed(3)}, ${Number(loc.lon).toFixed(3)}`;
    }

    const existing = await existingOfflinePackageFor(route, loc);
    if (existing) {
      if (automatic) toast('✓ Carte hors ligne déjà disponible pour cette sortie.');
      return existing;
    }

    state.offline.preparing = true;
    if (offlineUI.prepareBtn) offlineUI.prepareBtn.disabled = true;
    setOfflineProgress(true,
      automatic ? 'Sécurisation hors ligne…' : 'Préparation de la carte…',
      automatic ? 'L’activité continue pendant le téléchargement de la carte de secours.' : 'Téléchargement des routes, pistes, sentiers et points utiles OpenStreetMap.'
    );
    if (automatic) toast('⬇️ Préparation de la carte hors ligne en arrière-plan…');

    try {
      if (navigator.storage?.persist) { try { await navigator.storage.persist(); } catch (_) {} }
      const data = await fetchOfflineElementsSegmented(samples, Math.round(bufferKm * 1000));
      setOfflineProgress(true, 'Optimisation…', 'Réduction des données pour économiser l’espace du téléphone.');
      const features = compactOfflineElements(data);
      if (!features.length) throw new Error('Aucune donnée cartographique trouvée dans cette zone.');
      const bbox = offlineBoundsFromData(features, route);
      const now = Date.now();
      const center = samples[Math.floor(samples.length / 2)];
      if (center && navigator.onLine) await loadWeather(center.lat, center.lon, { silent:true });
      const pkg = {
        id:`offline-${now}-${Math.random().toString(36).slice(2,7)}`,
        name, createdAt:now, bufferKm, source, bbox, center,
        features, route,
        automatic: !!automatic,
        weather: state.lastWeather ? JSON.parse(JSON.stringify(state.lastWeather)) : null,
        weatherSavedAt: state.lastWeather ? Date.now() : null,
        summary: offlineFeatureSummary(features)
      };
      pkg.approxBytes = new Blob([JSON.stringify(pkg)]).size;
      await offlineDbPut(pkg);
      await renderOfflineAreas();
      setOfflineProgress(false);
      toast(automatic
        ? `✓ Carte hors ligne prête pour la sortie · ${(pkg.approxBytes/1024/1024).toFixed(1).replace('.',',')} Mo`
        : `Carte hors ligne prête · ${(pkg.approxBytes/1024/1024).toFixed(1).replace('.',',')} Mo`);
      return pkg;
    } catch (err) {
      setOfflineProgress(false);
      if (automatic) toast('⚠️ Carte hors ligne non préparée. L’activité continue normalement.');
      else toast(err?.message || 'Impossible de préparer la carte hors ligne.');
      return null;
    } finally {
      state.offline.preparing = false;
      if (offlineUI.prepareBtn) offlineUI.prepareBtn.disabled = false;
    }
  }

  async function autoPrepareOfflineForActivity(routeToFollow = null) {
    if (!navigator.onLine) return null;
    setAutoOfflineBadge('preparing');
    let pkg = null;
    try {
      // Corridor automatique volontairement plus léger pour être disponible
      // rapidement au départ. Une zone plus large reste téléchargeable manuellement.
      if (routeToFollow?.points?.length) {
        pkg = await createOfflinePackage({ route:routeToFollow, bufferKm:2, automatic:true });
      } else {
        const loc = state.location;
        if (!loc) {
          state.offline.pendingActivityPrepare = true;
          setAutoOfflineBadge(null);
          return null;
        }
        pkg = await createOfflinePackage({ loc, bufferKm:3, automatic:true });
      }
      if (pkg) {
        setAutoOfflineBadge('ready', '✓ Carte secours hors ligne prête');
        setTimeout(() => { if (document.getElementById('autoOfflineBadge')?.classList.contains('ready')) setAutoOfflineBadge(null); }, 8000);
      } else {
        setAutoOfflineBadge('partial', '⚠️ Carte secours non prête');
        setTimeout(() => setAutoOfflineBadge(null), 8000);
      }
      return pkg;
    } catch (_) {
      setAutoOfflineBadge('partial', '⚠️ Carte secours non prête');
      setTimeout(() => setAutoOfflineBadge(null), 8000);
      return null;
    }
  }

  async function prepareOfflineArea() {
    if (state.offline.preparing) return;
    if (!navigator.onLine) { toast('Connecte-toi pour préparer une nouvelle carte hors ligne.'); return; }
    const source = offlineUI.sourceSelect?.value || 'route';
    const bufferKm = Math.max(1, Math.min(5, Number(offlineUI.bufferSelect?.value || 3)));

    if (source === 'route') {
      if (!state.route?.points?.length) { toast('Charge d’abord un GPX ou un parcours.'); return; }
      await createOfflinePackage({ route:state.route, bufferKm, automatic:false });
      return;
    }

    let loc = state.location;
    if (!loc && 'geolocation' in navigator) {
      try {
        const pos = await new Promise((resolve,reject) => navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:3000,timeout:12000}));
        loc = { lat:pos.coords.latitude, lon:pos.coords.longitude };
      } catch (_) {}
    }
    if (!loc) { toast('Position GPS indisponible.'); return; }
    await createOfflinePackage({ loc, bufferKm, automatic:false });
  }

  async function renderOfflineAreas() {
    if (!offlineUI.list) return;
    try {
      const list = await offlineDbGetAll();
      if (!list.length) { offlineUI.list.innerHTML = '<div class="skeleton">Aucune carte hors ligne enregistrée.</div>'; return; }
      offlineUI.list.innerHTML = list.map(x => `
        <div class="offline-item" data-offline-id="${escapeHtml(x.id)}">
          <div class="offline-item-main"><strong>${escapeHtml(x.name || 'Carte locale')}</strong><small>${escapeHtml(x.summary || '')}<br>${formatOfflineDate(x.createdAt)} · ${x.bufferKm || 0} km de marge · ${((x.approxBytes||0)/1024/1024).toFixed(1).replace('.',',')} Mo</small></div>
          <div class="offline-item-actions">
            <button type="button" class="offline-use" data-offline-action="use" title="Utiliser la carte">🗺️</button>
            ${x.route ? '<button type="button" data-offline-action="route" title="Charger le parcours">GPX</button>' : ''}
            <button type="button" class="offline-delete" data-offline-action="delete" title="Supprimer">✕</button>
          </div>
        </div>`).join('');
    } catch (_) {
      offlineUI.list.innerHTML = '<div class="skeleton">Stockage hors ligne indisponible.</div>';
    }
  }

  async function handleOfflineListAction(e) {
    const btn=e.target.closest('[data-offline-action]'); const row=e.target.closest('[data-offline-id]');
    if(!btn||!row)return;
    const list=await offlineDbGetAll(); const pkg=list.find(x=>x.id===row.dataset.offlineId); if(!pkg)return;
    if(btn.dataset.offlineAction==='use') {
      activateOfflinePackage(pkg,{fit:true,forced:true}); showAppScreen('map',{scroll:false}); setTimeout(()=>state.map.invalidateSize(),50);
    } else if(btn.dataset.offlineAction==='route' && pkg.route) {
      state.route=JSON.parse(JSON.stringify(pkg.route)); drawRoute(true); renderRouteStats(); showAppScreen('routes'); toast(`Parcours chargé : ${pkg.route.name}`);
    } else if(btn.dataset.offlineAction==='delete') {
      if(!window.confirm(`Supprimer la carte hors ligne « ${pkg.name} » ?`))return;
      if(state.offline.activePackage?.id===pkg.id) deactivateOfflineMap({restoreOnline:navigator.onLine});
      await offlineDbDelete(pkg.id); await renderOfflineAreas();
    }
  }

  function bindOfflineEvents() {
    offlineUI.prepareBtn?.addEventListener('click', prepareOfflineArea);
    offlineUI.backOnlineBtn?.addEventListener('click', () => deactivateOfflineMap({restoreOnline:true}));
    offlineUI.list?.addEventListener('click', handleOfflineListAction);
    window.addEventListener('offline', handleOfflineNetworkLoss);
    window.addEventListener('online', handleOnlineReturn);
    updateOfflineNetworkBadge();
    renderOfflineAreas();
  }

  function bindEvents() {
    document.querySelectorAll('[data-basemap]').forEach(btn => btn.addEventListener('click', () => switchBase(btn.dataset.basemap)));
    ui.radarToggle.addEventListener('click', toggleRadar);
    ui.radarSlider.addEventListener('input', e => showRadarFrame(Number(e.target.value)));
    ui.radarPlay.addEventListener('click', toggleRadarAnimation);
    ui.locateBtn.addEventListener('click', () => { startLocation(true); ensureOrientationTracking(true).catch(() => {}); });
    ui.mapLocateBtn.addEventListener('click', e => {
      e.stopPropagation();
      startLocation(true);
      ensureOrientationTracking(true).then(() => applyAutomaticHeading()).catch(() => {});
    });
    ui.mapCompassBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      if (state.navigation.orientationMode === 'auto') {
        setOrientationMode('north', { notify:true });
      } else {
        await ensureOrientationTracking(true).catch(() => false);
        setOrientationMode('auto', { notify:true });
      }
    });
    ui.mapCloseBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (state.hikeFinder.active) stopHikeFinder(true);
      if (state.planner.active) stopPlanner(true);
      exitMapFullscreen();
    });
    ui.mapZoomInBtn.addEventListener('click', e => { e.stopPropagation(); state.map.zoomIn(); });
    ui.mapZoomOutBtn.addEventListener('click', e => { e.stopPropagation(); state.map.zoomOut(); });

    // V1.4.1 : garde Leaflet parfaitement ajusté à la largeur réelle du smartphone.
    const refreshMapSize = () => {
      if (!state.map) return;
      requestAnimationFrame(() => state.map.invalidateSize({ pan: false }));
    };
    window.addEventListener('resize', refreshMapSize, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(refreshMapSize, 180), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refreshMapSize, { passive: true });
    }
    setTimeout(refreshMapSize, 120);

    ui.gpxInput.addEventListener('change', e => e.target.files?.[0] && importGpx(e.target.files[0]));
    ui.clearRouteBtn.addEventListener('click', clearRoute);
    ui.exportRouteBtn.addEventListener('click', exportCurrentRoute);
    ui.routeStartBtn.addEventListener('click', startSelectedRouteActivity);
    ui.routeShowBtn.addEventListener('click', showCurrentRouteOnMap);
    ui.analyzeBtn.addEventListener('click', analyzeRoute);
    ui.refreshWeatherBtn.addEventListener('click', refreshWeatherNow);

    document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
      if (state.route && !ui.routeForecast.classList.contains('hidden')) analyzeRoute();
    }));

    ui.createRouteBtn.addEventListener('click', startPlanner);
    document.getElementById('routesCreateBtn')?.addEventListener('click', startPlanner);
    ui.routesFindHikesBtn?.addEventListener('click', startHikeFinder);
    ui.hikeFinderNewSearchBtn?.addEventListener('click', startHikeFinder);
    ui.hikeFinderCloseBtn?.addEventListener('click', () => { stopHikeFinder(true); exitMapFullscreen(); });
    ui.finderMapDetailClose?.addEventListener('click', closeFinderMapDetail);
    bindFinderMapDetailSheet();
    ui.finderDetailClose?.addEventListener('click', closeFinderDetailCard);
    ui.finderMapDetail?.querySelector('.finder-detail-actions')?.addEventListener('click', handleFinderDetailAction);
    ui.finderDetailCard?.querySelector('.finder-detail-card-actions')?.addEventListener('click', handleFinderDetailAction);
    ui.hikeFinderGpsBtn?.addEventListener('click', useGpsForHikeFinder);
    ui.hikeFinderListBtn?.addEventListener('click', () => {
      stopHikeFinder(true);
      exitMapFullscreen();
      showAppScreen('routes');
    });
    document.querySelectorAll('[data-hike-profile]').forEach(btn => btn.addEventListener('click', () => {
      const profile = btn.dataset.hikeProfile;
      if (!FINDER_PROFILES[profile]) return;
      if (state.hikeFinder.loading) {
        state.hikeFinder.requestSerial++;
        state.hikeFinder.loading = false;
      }
      state.hikeFinder.profile = profile;
      state.hikeFinder.results = [];
      state.hikeFinder.selectedIndex = -1;
      document.querySelectorAll('[data-hike-profile]').forEach(b => b.classList.toggle('active', b === btn));
      if (state.hikeFinder.resultLayer) state.map.removeLayer(state.hikeFinder.resultLayer);
      state.hikeFinder.resultLayer = null;
      state.hikeFinder.mapLines = [];
      renderHikeFinderResults();
      renderHikeFinderMapResults();
      const fp = getFinderProfile(profile);
      ui.hikeFinderStatus.textContent = `${fp.icon} ${fp.label} · touchez la carte ou utilisez Ma position.`;
      if (state.hikeFinder.center) searchHikesAround(state.hikeFinder.center);
    }));
    document.querySelectorAll('[data-hike-radius]').forEach(btn => btn.addEventListener('click', () => {
      const radius = Number(btn.dataset.hikeRadius);
      if (![2,5,10,20].includes(radius)) return;
      if (state.hikeFinder.loading) {
        state.hikeFinder.requestSerial++;
        state.hikeFinder.loading = false;
      }
      state.hikeFinder.radiusKm = radius;
      document.querySelectorAll('[data-hike-radius]').forEach(b => b.classList.toggle('active', b === btn));
      if (state.hikeFinder.center) searchHikesAround(state.hikeFinder.center);
    }));
    ui.hikeFinderMapResults?.addEventListener('click', e => {
      const btn = e.target.closest('[data-hike-map-index]');
      if (!btn) return;
      selectFinderResult(Number(btn.dataset.hikeMapIndex), true);
    });
    ui.hikeFinderResultsList?.addEventListener('click', handleHikeResultAction);
    ui.plannerGpsBtn.addEventListener('click', useGpsAsPlannerStart);
    ui.plannerCloseBtn?.addEventListener('click', () => {
      stopPlanner(true);
      if (state.mapFullscreen) exitMapFullscreen();
      toast('Création de parcours fermée.');
    });
    ui.plannerUndoBtn.addEventListener('click', undoPlannerWaypoint);
    ui.plannerClearBtn.addEventListener('click', clearPlanner);
    ui.plannerSaveBtn.addEventListener('click', savePlannerRoute);
    document.querySelectorAll('[data-planner-mode]').forEach(btn => btn.addEventListener('click', () => {
      const nextMode = btn.dataset.plannerMode;
      if (!PLANNER_PROFILES[nextMode]) return;
      state.planner.mode = nextMode;
      state.planner.routeValid = false;
      const profile = getPlannerProfile();
      document.querySelectorAll('[data-planner-mode]').forEach(b => b.classList.toggle('active', b === btn));
      ui.plannerStatus.textContent = `${profile.icon} ${profile.label} · ${profile.description}.`;
      if (state.planner.waypoints.length > 1) schedulePlannerRoute();
    }));
    ui.savedRoutesList.addEventListener('click', handleSavedRouteAction);

    ui.activityOpenBtn.addEventListener('click', () => { openActivityCard(); showAppScreen('activity'); });
    ui.activityCloseCardBtn.addEventListener('click', () => ui.activityCard.classList.add('hidden'));
    ui.activityStartBtn.addEventListener('click', activityMainButton);
    ui.activityExportBtn.addEventListener('click', exportActivity);
    document.querySelectorAll('[data-activity-mode]').forEach(btn => btn.addEventListener('click', () => {
      if (['recording','paused'].includes(state.activity.status)) {
        toast('Termine l’activité avant de changer de mode.');
        return;
      }
      const nextMode = btn.dataset.activityMode;
      if (!ACTIVITY_PROFILES[nextMode]) return;
      state.activity.mode = nextMode;
      document.querySelectorAll('[data-activity-mode]').forEach(b => b.classList.toggle('active', b === btn));
      updateActivityUI();
    }));
    ui.activityPauseBtn.addEventListener('click', toggleActivityPause);
    ui.activityStopBtn.addEventListener('click', finishActivity);
    ui.activityPanelToggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleActivityPanel();
    });
    ui.activityMapPanel?.addEventListener('click', (event) => {
      // Quand le panneau est réduit, un tap n’importe où sur sa zone libre l’agrandit.
      // Les boutons Pause/Stop/Destination continuent à fonctionner normalement.
      if (!ui.activityMapPanel.classList.contains('collapsed')) return;
      if (event.target.closest('button')) return;
      setActivityPanelCollapsed(false);
    });
    ui.activityMapPanel?.querySelector('.activity-map-head')?.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      if (!ui.activityMapPanel.classList.contains('collapsed')) setActivityPanelCollapsed(true);
    });
    ui.finishSaveBtn?.addEventListener('click', () => finalizeActivity(true));
    ui.finishDiscardBtn?.addEventListener('click', () => finalizeActivity(false));
    ui.finishCancelBtn?.addEventListener('click', closeFinishActivityModal);
    ui.finishActivityModal?.querySelector('[data-finish-action="cancel"]')?.addEventListener('click', closeFinishActivityModal);
    ui.targetSelectBtn.addEventListener('click', beginTargetSelection);
    ui.targetClearBtn.addEventListener('click', () => clearActivityTarget(true));

    // Navigation par écrans v1.6.1 : un seul écran visible à la fois.
    document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
      showAppScreen(btn.dataset.nav);
    }));

    document.querySelectorAll('[data-nav-action]').forEach(btn => btn.addEventListener('click', () => {
      const action = btn.dataset.navAction;
      if (action === 'activity') {
        openActivityCard();
        showAppScreen('activity');
      } else if (action === 'routes') {
        showAppScreen('routes');
      } else if (action === 'weather') {
        showAppScreen('weather');
      }
    }));

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.deferredInstall = e;
      ui.installBtn.classList.remove('hidden');
    });
    ui.installBtn.addEventListener('click', async () => {
      if (!state.deferredInstall) return;
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null;
      ui.installBtn.classList.add('hidden');
    });

    // Pull-to-refresh, fermeture d'onglet ou mise en arrière-plan : sauvegarde synchrone
    // de la dernière activité afin qu'un rechargement ne l'efface jamais.
    window.addEventListener('pagehide', () => persistActivitySnapshot(true));
    window.addEventListener('beforeunload', () => persistActivitySnapshot(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persistActivitySnapshot(true);
        // Les timers JS sont suspendus en arrière-plan. On mémorise l'intention
        // de lecture pour redémarrer proprement l'animation au retour.
        if (state.radarTimer) state.radarAnimationWanted = true;
        stopRadarAnimation({ keepWanted:true });
        persistRadarPrefs();
      } else {
        // Android peut suspendre ou recréer la WebView pendant que le service GPS
        // continue. À chaque retour au premier plan on reconstruit donc l'UI depuis
        // le service natif et son fichier de trace.
        recoverNativeActivityState({ reason:'visibility', allowRestart:true }).catch(() => {});
        resumeRadarAfterForeground().catch(() => {});
      }
    });
    window.addEventListener('pageshow', () => {
      recoverNativeActivityState({ reason:'pageshow', allowRestart:true }).catch(() => {});
      resumeRadarAfterForeground().catch(() => {});
    });
    window.addEventListener('focus', () => {
      if (document.visibilityState === 'visible') {
        recoverNativeActivityState({ reason:'focus', allowRestart:true }).catch(() => {});
        resumeRadarAfterForeground().catch(() => {});
      }
    });
  }

  function registerSW() {
    // Dans l'APK Capacitor, les fichiers de l'application sont déjà embarqués.
    // On évite le service worker PWA pour ne jamais conserver une ancienne version
    // de l'interface après une mise à jour de l'APK.
    const isNativeCapacitor = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    if (isNativeCapacitor) return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=1.10.26', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
  }

  initMap();
  ensureOrientationTracking(false).catch(() => {});
  bindEvents();
  bindOfflineEvents();
  const activityRestored = restoreActivitySnapshot();
  showAppScreen('map', { scroll: false });
  renderSavedRoutes();
  updateActivityUI();
  if (activityRestored) syncActivityMapPanel();
  // Récupération à froid : fonctionne même si Android a tué l'interface avant
  // que pagehide/localStorage ait eu le temps de sauvegarder la dernière seconde.
  setTimeout(() => recoverNativeActivityState({ reason:'cold-start-1', allowRestart:true }).catch(() => {}), 250);
  setTimeout(() => recoverNativeActivityState({ reason:'cold-start-2', allowRestart:true }).catch(() => {}), 1400);
  restoreRadarPrefs();
  registerSW();
  if (navigator.onLine && state.radarEnabled) loadRadar({ preserveSelection:false, silent:true }); else setTimeout(handleOfflineNetworkLoss, 250);
  setTimeout(() => startLocation(true), 400);
})();
