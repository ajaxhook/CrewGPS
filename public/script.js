function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = (window.URL || window.webkitURL).createObjectURL(file);
    const img = new Image();
    img.onload = () => { (window.URL || window.webkitURL).revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { (window.URL || window.webkitURL).revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function fileToJpegDataUrl(file, maxSize = 1280, quality = 0.9) {
  try {
    const img = await loadImageFromFile(file);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSize / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (e1) {
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
}

// =======================================================
// Script Principal da Aplicação
// =======================================================

// --- Globais e Estado ---
let map, directionsService;
let routeMarkers = [], routePolylines = [];
let currentEventData = {}; // Usado no formulário de criação de evento
let editingTripId = null;
let liveWatchId = null;
let userMarker = null;
let userPulse = null;
let followingUser = true;
let CURRENT_USER = null; // Detalhes do utilizador logado
let HIDDEN_THREADS = new Set(JSON.parse(localStorage.getItem('hiddenThreads') || '[]'));
let FRIENDS_CACHE = [];
let OUTGOING_CACHE = [];
let INCOMING_CACHE = [];
let ALL_USERS_CACHE = []; // Cache de todos os utilizadores
let CHAT_THREADS = []; // Cache das conversas ativas
let MY_TRIPS_CACHE = []; // Cache para Meus Eventos
let PUBLIC_TRIPS_CACHE = []; // Cache para Eventos Públicos
let ACTIVE_CHAT_FRIEND = null;
let CHAT_POLL = null;
const badgeSocialEl = document.getElementById('badge-social');
const badgeChatEl = document.getElementById('badge-chat');
let INVITE_TRIP_ID = null; // ID do evento/grupo para o qual estamos a convidar
let INVITE_SELECTED = new Set(); // IDs dos amigos selecionados para convite

// --- NOVOS: estado do mapa/seguimento/velocidade/animação ---
window.DRIVING_MODE = true;
window.DEFAULT_ZOOM = 16;
let USER_INTERACTING = false;  // marca se o utilizador mexeu no mapa
let lastCenterForInteract = null;
let lastZoomForInteract = null;

let lastGeoPos = null;         // última posição crua
let lastGeoTime = null;
let animFrameId = null;        // RAF para animação suave
let animFromLL = null;
let animToLL = null;
let animStart = 0;
let animDurationMs = 900;      // duração da transição entre pontos

// --- Manifest Fallback ---
(function ensureManifest() {
  const link = document.getElementById('app-manifest');
  if (!link) return;
  fetch(link.href, { method: 'HEAD' }).catch(() => {
    const manifest = { name: "CrewGPS", short_name: "CrewGPS", theme_color: "#6D28D9", background_color: "#111014", display: "standalone", start_url: "/", icons: [{ src: "/assets/Logo.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/assets/Logo.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    link.href = URL.createObjectURL(blob);
  });
})();

// --- Funções Google Maps (Globais) ---
function setupAutocomplete(input, bounds) {
  if (!input) return;

  // Preferir o novo PlaceAutocompleteElement se existir
  const NewAuto = google?.maps?.places?.PlaceAutocompleteElement;
  const OldAuto = google?.maps?.places?.Autocomplete;

  if (NewAuto) {
    const pae = new NewAuto();

    // Copiar atributos básicos
    pae.id = input.id + '-pae';
    pae.placeholder = input.placeholder || '';
    pae.value = input.value || '';

    if (bounds instanceof google.maps.LatLngBounds) {
      try { pae.bounds = bounds; } catch (_) { /* ignora se não suportar */ }
    }

    pae.style.display = 'block';
    pae.style.width = '100%';

    input.style.display = 'none';
    input.setAttribute('data-pae', pae.id);
    input.parentNode.insertBefore(pae, input.nextSibling);

    pae.addEventListener('gmpxplacechange', () => {
      let chosenText = '';
      try {
        if (typeof pae.value === 'string') {
          chosenText = pae.value;
        } else if (pae.value?.displayName) {
          chosenText = pae.value.displayName;
        } else if (pae.value?.formattedAddress) {
          chosenText = pae.value.formattedAddress;
        } else if (pae.place?.displayName) {
          chosenText = pae.place.displayName;
        } else if (pae.place?.formattedAddress) {
          chosenText = pae.place.formattedAddress;
        }
      } catch (_) { /* noop */ }

      if (!chosenText) {
        try { chosenText = pae.shadowRoot?.querySelector('input')?.value || ''; } catch (_) {}
      }

      input.value = chosenText || input.value;
      if (window.calculateAndDisplayRoute) window.calculateAndDisplayRoute();
    });

    input.addEventListener('change', () => { try { pae.value = input.value || ''; } catch (_) {} });

    return pae;
  }

  if (OldAuto) {
    const ac = new OldAuto(input, bounds ? { bounds, strictBounds: true } : {});
    ac.addListener('place_changed', () => {
      if (window.calculateAndDisplayRoute) window.calculateAndDisplayRoute();
    });
    return ac;
  }

  console.warn('Google Places Autocomplete indisponível nesta build.');
}
function clearMapElements() { routeMarkers.forEach(m => m.setMap(null)); routeMarkers = []; routePolylines.forEach(p => p.setMap(null)); routePolylines = []; }
function createPulseDOM() { const dot = document.createElement('div'); dot.style.width = '14px'; dot.style.height = '14px'; dot.style.borderRadius = '50%'; dot.style.background = '#6D28D9'; dot.style.boxShadow = '0 0 0 2px #fff'; dot.style.position = 'relative'; const ring = document.createElement('div'); ring.style.position = 'absolute'; ring.style.left = '50%'; ring.style.top = '50%'; ring.style.width = '14px'; ring.style.height = '14px'; ring.style.transform = 'translate(-50%,-50%)'; ring.style.borderRadius = '50%'; ring.style.background = 'rgba(109,40,217,.35)'; ring.style.animation = 'pulse 1.8s ease-out infinite'; dot.appendChild(ring); return dot; }
function addUserPulseMarker(latLng) { if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) { if (userPulse) userPulse.map = null; const dom = createPulseDOM(); userPulse = new google.maps.marker.AdvancedMarkerElement({ position: latLng, content: dom, map }); } else { if (!userMarker) { userMarker = new google.maps.Marker({ position: latLng, map, title: 'A minha localização', icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#6D28D9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } }); google.maps.event.addListener(map, 'dragstart', () => { followingUser = false;if (window.setModeDriving) window.setModeDriving(false, { centerNow: false });
 }); } else userMarker.setPosition(latLng); if (!userPulse) userPulse = new google.maps.Circle({ strokeColor: 'rgba(109,40,217,.25)', strokeOpacity: 0.6, strokeWeight: 1, fillColor: 'rgba(109,40,217,.15)', fillOpacity: 0.25, map, center: latLng, radius: 25 }); else userPulse.setCenter(latLng); } }
function moveUserPulse(latLng) { if (userPulse && userPulse.position) userPulse.position = latLng; else if (userPulse && userPulse.setCenter) userPulse.setCenter(latLng); if (userMarker) userMarker.setPosition(latLng); }

// --- NOVO: Interpolação para movimento suave ---
function lerp(a, b, t) { return a + (b - a) * t; }
function interpLatLng(from, to, t) {
  return new google.maps.LatLng(lerp(from.lat(), to.lat(), t), lerp(from.lng(), to.lng(), t));
}
function smoothMoveTo(targetLL) {
  if (!userPulse && !userMarker) { addUserPulseMarker(targetLL); }
  const currentLL = (userPulse && userPulse.position) ? userPulse.position : (userMarker ? userMarker.getPosition() : targetLL);

  animFromLL = currentLL;
  animToLL   = targetLL;
  animStart  = performance.now();

  if (animFrameId) cancelAnimationFrame(animFrameId);

  const step = (now) => {
    const t = Math.min(1, (now - animStart) / animDurationMs);
    const ll = interpLatLng(animFromLL, animToLL, t);
    moveUserPulse(ll);

    // Seguir no modo Conduzir
    if (followingUser && DRIVING_MODE && map) map.panTo(ll);

    if (t < 1) animFrameId = requestAnimationFrame(step);
  };
  animFrameId = requestAnimationFrame(step);
}

function startLiveTracking() {
  if (!navigator.geolocation || liveWatchId) return;

  const geoOpts = { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 };

  liveWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, speed } = pos.coords;
    const now = Date.now();
    const ll = new google.maps.LatLng(latitude, longitude);

    currentEventData.currentLocation = { lat: latitude, lng: longitude };

    if (!userPulse && !userMarker) addUserPulseMarker(ll);

    if (followingUser && DRIVING_MODE) {
      if (map && map.getZoom() < DEFAULT_ZOOM) map.setZoom(DEFAULT_ZOOM);
    }

    smoothMoveTo(ll);

    let metersPerSec = (typeof speed === 'number' && !isNaN(speed)) ? speed : null;
    if (metersPerSec == null && lastGeoPos && lastGeoTime) {
      const dt = (now - lastGeoTime) / 1000;
      if (dt > 0) {
        const dLat = (latitude - lastGeoPos.lat) * Math.PI / 180;
        const dLng = (longitude - lastGeoPos.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(latitude*Math.PI/180) * Math.cos(lastGeoPos.lat*Math.PI/180) * Math.sin(dLng/2)**2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = 6371000 * c; // metros
        metersPerSec = distance / dt;
      }
    }

    // --- NOVO: heading/tilt em conduzir (guardar prev antes de atualizar lastGeoPos) ---
    const prev = lastGeoPos ? { lat: lastGeoPos.lat, lng: lastGeoPos.lng } : null;
    lastGeoPos = { lat: latitude, lng: longitude };
    lastGeoTime = now;

    setSpeed(((metersPerSec || 0) * 3.6));

    try {
      if (prev) {
        const dist = metersBetween(prev, { lat: latitude, lng: longitude });
        if (dist > 4) {
          const hdg = bearingBetween(prev, { lat: latitude, lng: longitude });
          window.__lastHeading = hdg;
          if (DRIVING_MODE) setCamera(hdg, 50);
        }
      }
    } catch {}

    // === NOVO: pedir/atualizar limite de velocidade com throttling ===
    try {
      const nowMs = now;
      const movedEnough = !lastLimitPoint || metersBetween(lastLimitPoint, { lat: latitude, lng: longitude }) > 25; // >25m
      const waitedEnough = (nowMs - lastLimitFetchAt) > 12000; // >12s
      if (movedEnough || waitedEnough) {
        lastLimitFetchAt = nowMs;
        lastLimitPoint = { lat: latitude, lng: longitude };
        refreshSpeedLimit(latitude, longitude); // mostra mesmo parado
      }
    } catch (e) {
      console.warn('Falha ao atualizar speed limit:', e);
    }

  }, () => {
    // ignore errors
  }, geoOpts);
}


// --- Função de Callback do Google Maps ---
window.__actualInitMap = function () {
  const mapStyles = [{ elementType: "geometry", stylers: [{ color: "#1C1B22" }] }, { elementType: "labels.text.fill", stylers: [{ color: "#E4E4E7" }] }, { elementType: "labels.text.stroke", stylers: [{ visibility: "off" }] }, { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#32323D" }] }, { featureType: "poi", stylers: [{ visibility: "off" }] }, { featureType: "road", elementType: "geometry", stylers: [{ color: "#32323D" }] }, { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] }, { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1C1B22" }] }, { featureType: "water", elementType: "geometry", stylers: [{ color: "#1f1f2e" }] }];
  map = new google.maps.Map(document.getElementById("map"), { center: { lat: 32.6669, lng: -16.9241 }, zoom: DEFAULT_ZOOM, styles: mapStyles, disableDefaultUI: true, zoomControl: false, streetViewControl: false, fullscreenControl: false, mapTypeControl: false, keyboardShortcuts: false, clickableIcons: false, gestureHandling: 'greedy' });
  directionsService = new google.maps.DirectionsService();
  const madeiraBounds = new google.maps.LatLngBounds(new google.maps.LatLng(32.5, -17.3), new google.maps.LatLng(33.15, -16.25));

  // seguir desativa ao arrastar + troca logo para vista geral
  google.maps.event.addListener(map, 'dragstart', () => {
    followingUser = false;
    if (window.setModeDriving) window.setModeDriving(false, { centerNow: false });
  });

  // Assegura que o setupAutocomplete é chamado apenas quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupAutocomplete(document.getElementById('event-start'), madeiraBounds);
      setupAutocomplete(document.getElementById('event-end'), madeiraBounds);
    });
  } else {
    setupAutocomplete(document.getElementById('event-start'), madeiraBounds);
    setupAutocomplete(document.getElementById('event-end'), madeiraBounds);
  }

  // centra no utilizador e aplica zoom padrão
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => {
      const geocoder = new google.maps.Geocoder();
      const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
      currentEventData.currentLocation = loc;
      map.setCenter(loc);
      if (map.getZoom() < DEFAULT_ZOOM) map.setZoom(DEFAULT_ZOOM);
      refreshSpeedLimit(loc.lat, loc.lng);
      geocoder.geocode({ location: loc }, (results, status) => {
        if (status === 'OK' && results[0] && document.getElementById('event-start'))
          document.getElementById('event-start').value = 'Localização atual';
      });
    });
  }
  applyMapMode();
  startLiveTracking();

  // ligar os detectors assim que a função existir
  if (window.wireMapInteractionDetectors) {
    window.wireMapInteractionDetectors();
  } else {
    setTimeout(() => window.wireMapInteractionDetectors && window.wireMapInteractionDetectors(), 0);
  }

  if (window.__initMapPending) window.__initMapPending = false;
};

// --- Funções Auxiliares (PTR, Swipe) ---
function enablePTR(scrollEl, indicatorEl, onRefresh) {
  let startY = 0, pulling = false, currentH = 0, refreshing = false;
  const maxH = 80, triggerH = 56;
  if (typeof indicatorEl === 'string') {
    indicatorEl = document.getElementById(indicatorEl);
  }
  if (!indicatorEl) {
    console.warn("Elemento indicador de PTR não encontrado para", scrollEl.id);
    return;
  }
  if (!indicatorEl.parentNode && scrollEl.parentNode) {
    indicatorEl.className = 'ptr-indicator';
    indicatorEl.innerHTML = '<div class="ptr-bubble"><span class="spin"></span><span>A atualizar…</span></div>';
    if (getComputedStyle(scrollEl.parentNode).position === 'static') {
      scrollEl.parentNode.style.position = 'relative';
    }
    scrollEl.parentNode.insertBefore(indicatorEl, scrollEl);
  }
  function setH(h, animate = false) {
    currentH = Math.max(0, Math.min(maxH, h));
    if (animate) {
      indicatorEl.style.transition = 'height .25s ease, opacity .25s ease';
      scrollEl.style.transition = 'transform .25s ease';
    } else {
      indicatorEl.style.transition = '';
      scrollEl.style.transition = '';
    }
    indicatorEl.style.height = currentH + 'px';
    indicatorEl.style.opacity = String(Math.min(1, currentH / triggerH));
    scrollEl.style.transform = `translateY(${currentH}px)`;
  }
  scrollEl.addEventListener('touchstart', (e) => {
    if (scrollEl.scrollTop === 0 && e.touches.length === 1 && !refreshing) {
      pulling = true; startY = e.touches[0].clientY;
      indicatorEl.style.transition = ''; scrollEl.style.transition = '';
    }
  }, { passive: true });
  scrollEl.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      if (scrollEl.scrollTop === 0) e.preventDefault();
      setH(dy * 0.5);
    } else {
      setH(0);
    }
  }, { passive: false });
  async function finish() {
    refreshing = true; pulling = false;
    setH(triggerH, true);
    try { await onRefresh(); } catch (err) { console.error("PTR refresh failed:", err); }
    finally {
      setTimeout(() => {
        setH(0, true);
        setTimeout(() => {
          indicatorEl.style.transition = ''; scrollEl.style.transition = ''; refreshing = false;
        }, 260);
      }, 350);
    }
  }
  scrollEl.addEventListener('touchend', () => {
    if (!pulling || refreshing) return;
    pulling = false;
    if (currentH >= triggerH) { finish(); }
    else {
      setH(0, true);
      setTimeout(() => { indicatorEl.style.transition = ''; scrollEl.style.transition = ''; }, 260);
    }
  }, { passive: true });
}

function enableSwipeTabs(containerEl, tabButtonsNodeList) {
  let startX = 0, startY = 0, isMoving = false; const threshold = 50;
  const tabButtons = Array.from(tabButtonsNodeList);
  const currentIndex = () => tabButtons.findIndex(btn => btn.classList.contains('text-brand-purple'));
  containerEl.addEventListener('touchstart', (e) => { if (!e.touches || e.touches.length !== 1) return; const t = e.touches[0]; startX = t.clientX; startY = t.clientY; isMoving = true; }, { passive: true });
  containerEl.addEventListener('touchmove', (e) => { if (!isMoving) return; const dx = e.touches[0].clientX - startX; const dy = e.touches[0].clientY - startY; if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) e.preventDefault(); }, { passive: false });
  containerEl.addEventListener('touchend', (e) => { if (!isMoving) return; isMoving = false; const dx = (e.changedTouches && e.changedTouches[0].clientX - startX) || 0; const dy = (e.changedTouches && e.changedTouches[0].clientY - startY) || 0; if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) { const idx = currentIndex(); const next = dx < 0 ? Math.min(idx + 1, tabButtons.length - 1) : Math.max(idx - 1, 0); if (next !== idx && tabButtons[next]) tabButtons[next].click(); } }, { passive: true });
}

// =======================================================
// Início do Script Principal da Aplicação
// =======================================================
document.addEventListener('DOMContentLoaded', () => {
  // Referências DOM
  const authSection = document.getElementById('auth-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const createEventPage = document.getElementById('create-event-page');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const showForgotPasswordView = document.getElementById('show-forgot-password-view');
  const forgotForm = document.getElementById('forgot-password-form');
  const resetForm = document.getElementById('reset-password-form');
  const welcomeMessage = document.getElementById('welcome-message');
  const logoutBtn = document.getElementById('logout-btn');
  const authError = document.getElementById('auth-feedback');
  const viewContainer = document.querySelector('.view-container');
  const navButtons = document.querySelectorAll('.nav-btn');
  const VIEWS_COUNT = document.querySelectorAll('.view').length;
  const createEventFab = document.getElementById('create-event-fab');
  const backFromCreateBtn = document.getElementById('back-from-create-btn');
  const createEventForm = document.getElementById('create-event-form');
  const eventsTabButtons = document.querySelectorAll('.event-tab-btn');
  const publicEventsContent = document.getElementById('public-events-content');
  const myEventsContent = document.getElementById('my-events-content');
  const vehicleModal = document.getElementById('vehicle-modal');
  const closeVehicleModalBtn = document.getElementById('close-vehicle-modal-btn');
  const vehicleForm = document.getElementById('vehicle-form');
  const addVehicleBtn = document.getElementById('add-vehicle-btn');
  const garageContainer = document.getElementById('garage-container');
  const makeSelect = document.getElementById('modal-vehicle-make');
  const modelSelect = document.getElementById('modal-vehicle-model');
  const toggleChangePassword = document.getElementById('toggle-change-password');
  const changePasswordForm = document.getElementById('change-password-form');
  const deleteAccountBtn = document.getElementById('delete-account-btn');
  const invitesList = document.getElementById('invites-content');
  const userSearchInput = document.getElementById('user-search-input');
  const userSearchResults = document.getElementById('user-search-results');
  const chatUsersList = document.getElementById('chat-users-list');
  const chatSearchInput = document.getElementById('chat-search-input');
  const chatSearchResults = document.getElementById('chat-search-results');
  const convoPage = document.getElementById('chat-convo-page');
  const convoBackBtn = document.getElementById('convo-back-btn');
  const convoAvatar = document.getElementById('convo-avatar');
  const convoUsername = document.getElementById('convo-username');
  const convoMessages = document.getElementById('convo-messages');
  const convoForm = document.getElementById('convo-form');
  const convoInput = document.getElementById('convo-input');
  const openFriendsPageBtn = document.getElementById('open-friends-page');
  const friendsPage = document.getElementById('friends-page');
  const friendsBackBtn = document.getElementById('friends-back-btn');
  const friendsPageList = document.getElementById('friends-page-list');
  const myGroupsList = document.getElementById('my-groups-list');
  const refreshGroupsBtn = document.getElementById('refresh-groups');
  const createGroupForm = document.getElementById('create-group-form');
  const groupNameInput = document.getElementById('group-name');
  const groupDescInput = document.getElementById('group-desc');
  const groupSearchInput = document.getElementById('group-search');
  const groupSearchBtn = document.getElementById('group-search-btn');
  const groupSearchResults = document.getElementById('group-search-results');
  const groupSelected = document.getElementById('group-selected');
  const inviteModal = document.getElementById('invite-modal');
  const inviteClose = document.getElementById('invite-close');
  const inviteCancel = document.getElementById('invite-cancel');
  const inviteSearch = document.getElementById('invite-search');
  const inviteFriendsList = document.getElementById('invite-friends-list');
  const inviteSubmit = document.getElementById('invite-submit');
  const unfriendModal = document.getElementById('unfriend-modal');
  const unfriendText = document.getElementById('unfriend-text');
  const unfriendConfirm = document.getElementById('unfriend-confirm');
  const unfriendCancel = document.getElementById('unfriend-cancel');
  const cropperModal = document.getElementById('cropper-modal');
  const cropperImage = document.getElementById('cropper-image');
  const cropperZoom = document.getElementById('cropper-zoom');
  const cropperCancel = document.getElementById('cropper-cancel');
  const cropperSave = document.getElementById('cropper-save');
  const pageStopsContainer = document.getElementById('page-stops-container');

  // Refs para o Modal de Detalhes do Evento
  const eventDetailsModal = document.getElementById('event-details-modal');
  const eventDetailsCloseBtn = document.getElementById('event-details-close-btn');
  const eventDetailsTitle = document.getElementById('event-details-title');
  const eventDetailsDatetime = document.getElementById('event-details-datetime');
  const eventDetailsDescription = document.getElementById('event-details-description');
  const eventDetailsDescriptionWrapper = document.getElementById('event-details-description-wrapper');
  const eventDetailsRoute = document.getElementById('event-details-route');
  const eventDetailsParticipants = document.getElementById('event-details-participants');
  const eventDetailsActionBtn = document.getElementById('event-details-action-btn');
  const eventDetailsEditBtn = document.getElementById('event-details-edit-btn');
  const eventDetailsDeleteBtn = document.getElementById('event-details-delete-btn');
  let currentOpenEventId = null;

  // ** CORREÇÃO: Variável movida para dentro do DOMContentLoaded **
  let cropState = { dragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0, zoom: 1, img: null };

  function updateCropperTransform() {
    cropperImage.style.transform = `translate(-50%, -50%) translate(${cropState.offsetX}px, ${cropState.offsetY}px) scale(${cropState.zoom})`;
  }
  function startDrag(e) { cropState.dragging = true; const t = (e.touches && e.touches[0]) || e; cropState.startX = t.clientX; cropState.startY = t.clientY; }
  function moveDrag(e) { if (!cropState.dragging) return; const t = (e.touches && e.touches[0]) || e; cropState.offsetX += (t.clientX - cropState.startX) / cropState.zoom; cropState.offsetY += (t.clientY - cropState.startY) / cropState.zoom; cropState.startX = t.clientX; cropState.startY = t.clientY; updateCropperTransform(); }
  function endDrag() { cropState.dragging = false; }

  window.calculateAndDisplayRoute = function () {
    const startVal = document.getElementById('event-start').value;
    const endVal = document.getElementById('event-end').value;
    const pageTripError = document.getElementById('page-trip-error');
    pageTripError.textContent = '';
    if (!startVal || !endVal) return;

    const waypoints = Array.from(pageStopsContainer.querySelectorAll('input')).map(i => i.value).filter(Boolean).map(v => ({ location: v, stopover: true }));
    let origin;
    if (startVal.trim().toLowerCase().startsWith('localização atual') && currentEventData.currentLocation) {
      origin = new google.maps.LatLng(currentEventData.currentLocation.lat, currentEventData.currentLocation.lng);
    } else origin = startVal;

    if (!directionsService) {
      console.error("Directions Service não inicializado.");
      pageTripError.textContent = 'Erro ao carregar serviço de rotas.';
      return;
    }

    directionsService.route({ origin, destination: endVal, waypoints, travelMode: google.maps.TravelMode.DRIVING }, (response, status) => {
      if (status === 'OK' && response && response.routes && response.routes.length > 0) {
        const route = response.routes[0];
        const totalDistance = route.legs.reduce((a, l) => a + (l.distance?.value || 0), 0);
        const totalDuration = route.legs.reduce((a, l) => a + (l.duration?.value || 0), 0);
        const distanceKm = (totalDistance / 1000).toFixed(1);
        const hours = Math.floor(totalDuration / 3600);
        const minutes = Math.floor((totalDuration % 3600) / 60);
        currentEventData.durationText = `${hours}h ${minutes}min`;
        currentEventData.distanceText = `${distanceKm} km`;
        const startAddr = route.legs[0]?.start_address?.split(',')[0] || startVal;
        const endAddr = route.legs[route.legs.length - 1]?.end_address?.split(',')[0] || endVal;
        document.getElementById('page-route-summary').textContent = `${startAddr} → ${endAddr}`;

        if (startVal.trim().toLowerCase().startsWith('localização atual')) {
          currentEventData.resolvedStartLocation = {
            description: startAddr,
            lat: origin.lat(),
            lng: origin.lng()
          };
        } else {
          currentEventData.resolvedStartLocation = null;
        }
      } else {
        console.error('Erro do Directions Service:', status);
        pageTripError.textContent = 'Não foi possível encontrar a rota. Verifique se as moradas estão corretas e completas.';
        document.getElementById('page-route-summary').textContent = 'Defina um percurso válido';
      }
    });
  };

  // Remover aba 'Friends' do Social
  const friendsTabBtn = document.querySelector('.social-tab-btn[data-tab="friends"]');
  document.getElementById('friends-content')?.remove();
  friendsTabBtn?.remove();
  let socialTabButtons = document.querySelectorAll('.social-tab-btn');

  const API_URL = window.location.origin;

  function getStoredToken() {
    const raw = localStorage.getItem('token') || '';
    return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  }
  function authHeaders(extra = {}) {
    const token = getStoredToken();
    return token ? { ...extra, 'x-auth-token': token, 'Authorization': `Bearer ${token}` } : { ...extra };
  }

  async function markThreadRead(userId) {
    const token = localStorage.getItem('token');
    if (!token || !userId) return;
    try {
      await fetch(`${API_URL}/api/chat/${userId}/read`, {
        method: 'POST',
        headers: authHeaders()
      });
    } catch (err) { console.error("Falha ao marcar como lido:", err); }
  }

  enableSwipeTabs(document.getElementById('events-view'), eventsTabButtons);
  enableSwipeTabs(document.getElementById('social-view'), socialTabButtons);

  /* ===== Helpers UI ===== */
  function openModal(el) { el.classList.remove('hidden'); requestAnimationFrame(() => el.classList.add('modal-enter', 'modal-enter-to')); }
  function closeModal(el) { el.classList.remove('modal-enter-to'); setTimeout(() => el.classList.add('hidden'), 260); }
  function timeAgo(ts) {
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!t || isNaN(t)) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24); return `${d}d`;
  }
  function setBadge(el, count) {
    if (!el) return;
    const n = Math.max(0, Number(count) || 0);
    if (n <= 0) { el.classList.remove('show'); return; }
    el.textContent = n > 5 ? '5+' : String(n);
    el.classList.add('show');
  }

  /* ===== Navegação e Abas ===== */
  navButtons.forEach(button => button.addEventListener('click', () => {
    const viewIndex = Number(button.dataset.view || 0);
    viewContainer.style.transform = `translateX(-${viewIndex * (100 / VIEWS_COUNT)}%)`;
    navButtons.forEach(btn => btn.classList.remove('nav-active'));
    button.classList.add('nav-active');
  }));
  socialTabButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const tab = button.dataset.tab;
      socialTabButtons.forEach(btn => { btn.classList.remove('text-brand-purple', 'border-brand-purple'); btn.classList.add('text-brand-gray-200', 'border-transparent', 'hover:text-white', 'hover:border-white'); });
      button.classList.add('text-brand-purple', 'border-brand-purple');
      button.classList.remove('text-brand-gray-200', 'border-transparent', 'hover:text-white', 'hover:border-white');
      ['search', 'invites', 'groups'].forEach(id => document.getElementById(`${id}-content`)?.classList.add('hidden'));
      document.getElementById(`${tab}-content`)?.classList.remove('hidden');
      if (tab === 'invites') await fetchIncomingInvites();
      if (tab === 'groups') { await Promise.all([fetchMyGroups(), searchGroups(groupSearchInput.value || '')]); }
    });
  });
  eventsTabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      eventsTabButtons.forEach(btn => { btn.classList.remove('text-brand-purple', 'border-brand-purple'); btn.classList.add('text-brand-gray-200', 'border-transparent', 'hover:text-white', 'hover:border-white'); });
      button.classList.add('text-brand-purple', 'border-brand-purple');
      button.classList.remove('text-brand-gray-200', 'border-transparent', 'hover:text-white', 'hover:border-white');
      document.getElementById('public-events-content')?.classList.add('hidden');
      document.getElementById('my-events-content')?.classList.add('hidden');
      document.getElementById(`${tab}-content`)?.classList.remove('hidden');
    });
  });

  /* ===== Auth Views ===== */
  document.getElementById('show-register-view').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('login-view').classList.add('hidden'); document.getElementById('register-view').classList.remove('hidden'); authError.textContent = ''; });
  document.querySelectorAll('.show-login-view').forEach(link => link.addEventListener('click', (e) => {
    e.preventDefault();
    ['register-view', 'forgot-password-view', 'reset-password-view'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('login-view').classList.remove('hidden');
    authError.textContent = '';
  }));
  showForgotPasswordView.addEventListener('click', (e) => {
    e.preventDefault();
    ['login-view', 'register-view', 'reset-password-view'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('forgot-password-view').classList.remove('hidden');
  });

  /* ===== Segurança UI ===== */
  document.addEventListener('click', (e) => {
    if (e.target.closest('#toggle-change-password')) {
      changePasswordForm.classList.toggle('hidden');
      changePasswordForm.parentElement.classList.add('modal-enter');
      requestAnimationFrame(() => changePasswordForm.parentElement.classList.add('modal-enter-to'));
      setTimeout(() => changePasswordForm.parentElement.classList.remove('modal-enter', 'modal-enter-to'), 200);
    }
  });
  deleteAccountBtn.addEventListener('click', () => {
    if (confirm('Tem a certeza que quer apagar a conta? Esta ação é irreversível.')) {
      const token = localStorage.getItem('token');
      fetch(`${API_URL}/api/users/me`, { method: 'DELETE', headers: authHeaders() })
        .then(async res => { if (!res.ok) throw await res.json(); localStorage.removeItem('token'); location.reload(); })
        .catch(() => alert('Não foi possível apagar a conta.'));
    }
  });

  /* ===== Password Reset ===== */
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    try {
      const res = await fetch(`${API_URL}/api/password/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await res.json(); if (!res.ok) throw data;
      alert('Email enviado. Verifique a sua caixa de correio.');
      document.getElementById('reset-email').value = email;
      document.getElementById('forgot-password-view').classList.add('hidden');
      document.getElementById('reset-password-view').classList.remove('hidden');
    } catch (err) {
      alert(err?.msg || 'Não foi possível enviar email.');
    }
  });
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;
    const code = document.getElementById('reset-code').value;
    const newPassword = document.getElementById('reset-password').value;
    try {
      const res = await fetch(`${API_URL}/api/password/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, token: code, newPassword }) });
      const data = await res.json(); if (!res.ok) throw data;
      alert('Password redefinida. Faça login.');
      document.getElementById('reset-password-view').classList.add('hidden');
      document.getElementById('login-view').classList.remove('hidden');
    } catch (err) {
      alert(err?.msg || 'Não foi possível redefinir password.');
    }
  });

  /* ===== Garagem ===== */
  const carDataRaw = { "BMW": ["Série 1", "Série 2", "Série 3", "Série 4", "Série 5", "Série 7", "Série 8", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "i3", "i4", "iX", "i8"], "Mercedes-Benz": ["Classe A", "Classe B", "Classe C", "Classe E", "Classe S", "CLA", "CLS", "GLA", "GLB", "GLC", "GLE", "GLS", "EQC", "EQE", "EQS", "AMG GT"], "Audi": ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "e-tron"], "Volkswagen": ["Polo", "T-Cross", "Taigo", "T-Roc", "Golf", "Golf Variant", "Passat", "Tiguan", "Tiguan Allspace", "Touareg", "Arteon", "ID.3", "ID.4", "ID.5", "ID.7"], "Ford": ["Ka", "Fiesta", "Focus", "Puma", "Kuga", "EcoSport", "Mustang", "Explorer", "Transit"], "Toyota": ["Aygo", "Yaris", "GR Yaris", "Corolla", "C-HR", "RAV4", "Supra", "Prius"], "Honda": ["Jazz", "Civic", "HR-V", "CR-V", "e", "NSX"], "Renault": ["Clio", "Captur", "Megane", "Kadjar", "Scénic", "Talisman", "Espace", "Arkana", "Kwid", "Zoe"], "Peugeot": ["108", "208", "e-208", "2008", "e-2008", "3008", "5008", "308", "508", "Rifter"], "Citroën": ["C1", "C3", "C3 Aircross", "C4", "C4 Cactus", "C5 Aircross", "C5 X", "Ami", "ë-C4"], "Nissan": ["Micra", "Juke", "Qashqai", "X-Trail", "Leaf", "Ariya"], "Hyundai": ["i10", "i20", "i30", "Kona", "Tucson", "Santa Fe", "Ioniq 5", "Ioniq 6", "Kona Electric"], "Kia": ["Picanto", "Rio", "Ceed", "Stonic", "Sportage", "Sorento", "EV6", "Niro"], "Mazda": ["Mazda2", "Mazda3", "CX-30", "CX-5", "MX-30", "MX-5"], "Skoda": ["Fabia", "Scala", "Octavia", "Karoq", "Kodiaq", "Enyaq"], "Seat": ["Mii", "Ibiza", "Arona", "Leon", "Tarraco", "Ateca"], "Jaguar": ["XE", "XF", "F-Pace", "E-Pace", "I-Pace"], "Land Rover": ["Range Rover", "Range Rover Sport", "Velar", "Evoque", "Discovery", "Defender"], "Volvo": ["XC40", "XC60", "XC90", "S60", "S90", "V60"], "Tesla": ["Model 3", "Model Y", "Model S", "Model X"], "Porsche": ["911", "Cayenne", "Macan", "Panamera", "Taycan"], "Ferrari": ["488", "F8 Tributo", "SF90 Stradale", "Roma", "Portofino", "F12", "812 Superfast"], "Lamborghini": ["Huracán", "Aventador", "Urus"], "Alfa Romeo": ["Giulia", "Stelvio", "Tonale"], "Mitsubishi": ["Space Star", "ASX", "Eclipse Cross", "Outlander"], "Suzuki": ["Swift", "Ignis", "Vitara", "S-Cross"], "MG": ["MG4", "ZS EV", "HS"], "Dacia": ["Sandero", "Logan", "Duster", "Jogger"], "Fiat": ["500", "Panda", "Tipo", "500X"], "Jeep": ["Renegade", "Compass", "Wrangler"], "Mini": ["Hatch", "Clubman", "Countryman"], "Opel": ["Corsa", "Astra", "Crossland", "Grandland", "Mokka", "Zafira"] };
  const carData = {}; Object.keys(carDataRaw).sort((a, b) => a.localeCompare(b, 'pt')).forEach(m => carData[m] = carDataRaw[m].slice().sort((a, b) => a.localeCompare(b, 'pt')));
  function populateMakes() { makeSelect.innerHTML = '<option value="">Selecione a Marca</option>'; Object.keys(carData).forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; makeSelect.appendChild(o); }); }
  populateMakes();
  makeSelect.addEventListener('change', () => { const sel = makeSelect.value; modelSelect.innerHTML = '<option value="">Selecione o Modelo</option>'; if (sel && carData[sel]) carData[sel].forEach(md => { const o = document.createElement('option'); o.value = md; o.textContent = md; modelSelect.appendChild(o); }); });
  function getTextColorForBg(bg) { if (!bg) return '#F1F1F3'; const c = (bg[0] === '#') ? bg.substring(1, 7) : bg; const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16); return (((r * .299) + (g * .587) + (b * .114)) > 186) ? '#111014' : '#F1F1F3'; }
  let userGarage = []; // Ensure userGarage is defined
  function renderGarage() { garageContainer.innerHTML = ''; (userGarage || []).forEach((v, i) => { const card = document.createElement('div'); card.className = 'vehicle-card w-full p-4 rounded-lg shadow-lg relative cursor-pointer'; const bg = v.color || '#1C1B22'; card.style.backgroundColor = bg; card.style.color = getTextColorForBg(bg); card.dataset.index = i; card.innerHTML = `<div><p class="text-xs opacity-70">Marca</p><h3 class="text-lg font-bold">${v.make}</h3><p class="text-xs opacity-70 mt-2">Modelo</p><h4 class="text-md font-semibold">${v.model}</h4><p class="text-xs opacity-70 mt-2">Matrícula</p><h4 class="text-md font-semibold">${v.plate}</h4></div>`; garageContainer.appendChild(card); }); garageContainer.appendChild(addVehicleBtn); addVehicleBtn.classList.remove('hidden'); }
  closeVehicleModalBtn.addEventListener('click', () => closeModal(vehicleModal));
  addVehicleBtn.addEventListener('click', () => openModal(vehicleModal));
  vehicleModal.addEventListener('click', e => { if (e.target === vehicleModal) closeModal(vehicleModal); });
  vehicleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newVehicle = {
      make: document.getElementById('modal-vehicle-make').value,
      model: document.getElementById('modal-vehicle-model').value,
      color: document.getElementById('modal-vehicle-color').value,
      plate: document.getElementById('modal-vehicle-plate').value,
    };
    try {
      const res = await fetch(`${API_URL}/api/garage`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ make: newVehicle.make, model: newVehicle.model, matricula: newVehicle.plate, cor: newVehicle.color }) });
      const data = await res.json(); if (!res.ok) throw data;
      closeModal(vehicleModal);
      await fetchUserData();
    } catch (err) { alert(err?.msg || 'Erro ao guardar o veículo.'); }
  });

  /* ===== Modals (Invite, Unfriend, Event Details) ===== */
  let UNFRIEND_TARGET = null; // Define UNFRIEND_TARGET
  function openInviteModal(tripId) { INVITE_TRIP_ID = tripId; INVITE_SELECTED.clear(); inviteSearch.value = ''; renderInviteList(FRIENDS_CACHE); openModal(inviteModal); }
  function hideInviteModal() { closeModal(inviteModal); }
  inviteClose.addEventListener('click', hideInviteModal);
  inviteCancel.addEventListener('click', hideInviteModal);
  inviteModal.addEventListener('click', e => { if (e.target === inviteModal) hideInviteModal(); });
  inviteSearch.addEventListener('input', () => {
    const q = inviteSearch.value.toLowerCase();
    const filtered = FRIENDS_CACHE.filter(f => (f.nome || '').toLowerCase().includes(q));
    renderInviteList(filtered);
  });
  function renderInviteList(list) {
    inviteFriendsList.innerHTML = '';
    if (!list || list.length === 0) { inviteFriendsList.innerHTML = '<p class="text-sm text-brand-gray-200">Sem amigos.</p>'; return; }
    list.forEach(f => {
      const row = document.createElement('label');
      row.className = 'flex items-center justify-between bg-brand-gray-900 rounded px-3 py-2';
      const checked = INVITE_SELECTED.has(f._id) ? 'checked' : '';
      row.innerHTML = `<div class="flex items-center gap-3"><img src="${f.profilePicture || 'https://placehold.co/32x32/1C1B22/E4E4E7?text=' + (f.nome?.[0] || 'U')}" class="w-8 h-8 rounded-full object-cover"><span class="text-sm">${f.nome}</span></div><input type="checkbox" data-id="${f._id}" ${checked} class="w-4 h-4">`;
      inviteFriendsList.appendChild(row);
    });
  }
  inviteFriendsList.addEventListener('change', e => {
    const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
    const id = cb.dataset.id;
    if (cb.checked) INVITE_SELECTED.add(id); else INVITE_SELECTED.delete(id);
  });
  inviteSubmit.addEventListener('click', () => {
    console.warn("Botão de submeter convite clicado sem contexto (Evento ou Grupo).");
  });

  function openUnfriendModal(friend) { UNFRIEND_TARGET = friend; unfriendText.textContent = `Quer deixar de ser amigo de ${friend.nome}?`; openModal(unfriendModal); }
  function hideUnfriendModal() { UNFRIEND_TARGET = null; closeModal(unfriendModal); }
  unfriendCancel.addEventListener('click', hideUnfriendModal);
  unfriendModal.addEventListener('click', e => { if (e.target === unfriendModal) hideUnfriendModal(); });
  unfriendConfirm.addEventListener('click', async () => {
    if (!UNFRIEND_TARGET) return;
    try {
      const res = await fetch(`${API_URL}/api/friends/${UNFRIEND_TARGET._id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json(); if (!res.ok) throw data;
      hideUnfriendModal();
      await refreshAllData();
    } catch (err) { alert(err?.msg || 'Não foi possível remover amigo.'); }
  });

  // ** NOVO: Funções do Modal de Eventos **
  function renderParticipantList(participants = []) {
    if (!participants || participants.length === 0) {
      const trip = (PUBLIC_TRIPS_CACHE.find(t => t._id === currentOpenEventId) || MY_TRIPS_CACHE.find(t => t._id === currentOpenEventId));
      if (trip?.user) {
        return renderParticipantList([trip.user]);
      }
      return '<p class="text-sm text-brand-gray-200">Ainda sem participantes confirmados.</p>';
    }

    const participantDetails = participants.map(p => {
      const pId = (typeof p === 'string') ? p : p._id;
      if (CURRENT_USER && pId === CURRENT_USER._id) return CURRENT_USER;
      let user = FRIENDS_CACHE.find(f => f._id === pId);
      if (!user) user = ALL_USERS_CACHE.find(u => u._id === pId);
      if (!user && p.nome) return p;
      return user || { _id: pId, nome: 'Utilizador...' };
    });

    return participantDetails.map(p => `
      <div class="flex items-center gap-2">
        <img src="${p.profilePicture || `https://placehold.co/24x24/1C1B22/E4E4E7?text=${(p.nome?.[0] || '?')}`}" class="w-6 h-6 rounded-full object-cover" alt="">
        <span>${p.nome || 'Desconhecido'} ${p._id === CURRENT_USER?._id ? '(Você)' : ''}</span>
      </div>
    `).join('');
  }

  async function openEventDetailsModal(trip) {
    if (!trip) return;
    currentOpenEventId = trip._id;

    const freshTripData = MY_TRIPS_CACHE.find(t => t._id === trip._id) || PUBLIC_TRIPS_CACHE.find(t => t._id === trip._id) || trip;

    eventDetailsTitle.textContent = freshTripData.routeName || 'Detalhes do Evento';
    eventDetailsDatetime.textContent = new Date(freshTripData.date).toLocaleString('pt-PT', { dateStyle: 'long', timeStyle: 'short' });

    if (freshTripData.description) {
      eventDetailsDescription.textContent = freshTripData.description;
      eventDetailsDescriptionWrapper.classList.remove('hidden');
    } else {
      eventDetailsDescription.textContent = '';
      eventDetailsDescriptionWrapper.classList.add('hidden');
    }

    const start = freshTripData.startLocation?.description || 'N/D';
    const end = freshTripData.endLocation?.description || 'N/D';
    eventDetailsRoute.textContent = `${start} → ${end}`;

    eventDetailsParticipants.innerHTML = renderParticipantList(freshTripData.participants);

    const isParticipating = freshTripData.participants?.some(p => (p === CURRENT_USER?._id) || (p._id === CURRENT_USER?._id));
    const isMine = (freshTripData.user && CURRENT_USER && (freshTripData.user._id === CURRENT_USER._id || freshTripData.user === CURRENT_USER._id));

    if (isParticipating) {
      eventDetailsActionBtn.textContent = 'Cancelar Participação';
      eventDetailsActionBtn.className = 'w-full font-bold py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors duração-200';
      eventDetailsActionBtn.onclick = () => handleEventParticipation('leave', freshTripData._id);
    } else {
      eventDetailsActionBtn.textContent = 'Confirmar Participação';
      eventDetailsActionBtn.className = 'w-full font-bold py-2.5 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors duração-200';
      eventDetailsActionBtn.onclick = () => handleEventParticipation('join', freshTripData._id);
    }
    eventDetailsActionBtn.disabled = false;

    if (isMine) {
      eventDetailsEditBtn.classList.remove('hidden');
      eventDetailsDeleteBtn.classList.remove('hidden');
      eventDetailsEditBtn.onclick = () => {
        closeModal(eventDetailsModal);
        showCreateEventPage(freshTripData);
      };
      eventDetailsDeleteBtn.onclick = async () => {
        if (confirm('Tem a certeza de que quer apagar este evento?')) {
          closeModal(eventDetailsModal);
          try {
            const res = await fetch(`${API_URL}/api/trips/${freshTripData._id}`, { method: 'DELETE', headers: authHeaders() });
            if (!res.ok) throw await res.json();
            await refreshAllData();
          } catch (err) { alert(err.msg || 'Não foi possível apagar o evento.'); }
        }
      };
    } else {
      eventDetailsEditBtn.classList.add('hidden');
      eventDetailsDeleteBtn.classList.add('hidden');
    }

    openModal(eventDetailsModal);
  }

  async function handleEventParticipation(action, tripId) {
    if (!tripId) return;
    eventDetailsActionBtn.disabled = true; eventDetailsActionBtn.textContent = 'A processar...';
    try {
      const res = await fetch(`${API_URL}/api/trips/${tripId}/${action}`, {
        method: 'POST', headers: authHeaders()
      });
      const updatedTrip = await res.json();
      if (!res.ok) throw updatedTrip;

      const updateCache = (cache, id, data) => {
        const index = cache.findIndex(t => t._id === id);
        if (index > -1) cache[index] = data;
        return cache;
      };
      MY_TRIPS_CACHE = updateCache(MY_TRIPS_CACHE, tripId, updatedTrip);
      PUBLIC_TRIPS_CACHE = updateCache(PUBLIC_TRIPS_CACHE, tripId, updatedTrip);

      renderTrips(MY_TRIPS_CACHE, myEventsContent, false);
      renderTrips(PUBLIC_TRIPS_CACHE, publicEventsContent, true);
      applyFilters();

      openEventDetailsModal(updatedTrip);

    } catch (err) {
      alert(`Erro ao ${action === 'join' ? 'confirmar' : 'cancelar'} participação: ${err?.msg || 'Tente novamente.'}`);
      if (currentOpenEventId === tripId) {
        const isParticipating = action === 'leave';
        if (isParticipating) {
          eventDetailsActionBtn.textContent = 'Cancelar Participação';
          eventDetailsActionBtn.className = 'w-full font-bold py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors duração-200';
        } else {
          eventDetailsActionBtn.textContent = 'Confirmar Participação';
          eventDetailsActionBtn.className = 'w-full font-bold py-2.5 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors duração-200';
        }
        eventDetailsActionBtn.disabled = false;
      }
    }
  }

  eventDetailsCloseBtn.addEventListener('click', () => closeModal(eventDetailsModal));
  eventDetailsModal.addEventListener('click', e => { if (e.target === eventDetailsModal) closeModal(eventDetailsModal); });

  /* ===== Criar/Editar Evento ===== */
  function showCreateEventPage(trip = null) {
    createEventForm.reset(); editingTripId = null;
    document.getElementById('page-stops-container').innerHTML = '';
    document.getElementById('create-edit-title').textContent = 'Criar Evento';
    document.getElementById('submit-event-btn').textContent = 'Criar Evento';

    currentEventData = {};

    if (trip) {
      editingTripId = trip._id;
      document.getElementById('create-edit-title').textContent = 'Editar Evento';
      document.getElementById('submit-event-btn').textContent = 'Guardar Alterações';
      document.getElementById('event-title').value = trip.routeName || '';
      document.getElementById('event-description').value = trip.description || '';
      if (trip.date) {
        const localDate = new Date(new Date(trip.date).getTime() - new Date().getTimezoneOffset() * 60000);
        document.getElementById('event-datetime').value = localDate.toISOString().slice(0, 16);
      }
      document.getElementById('event-public').checked = !!trip.isPublic;
      document.getElementById('event-start').value = trip.startLocation?.description || 'Localização atual';
      document.getElementById('event-end').value = trip.endLocation?.description || '';

      if (trip.stops && trip.stops.length > 0) {
        trip.stops.forEach(stop => {
          const stopId = `page-stop-${pageStopsContainer.children.length}`;
          const div = document.createElement('div');
          div.className = 'p-4 rounded-lg border border-dashed border-brand-gray-700 relative';
          div.innerHTML = `<input type="text" id="${stopId}" value="${stop.description || ''}" placeholder="Adicionar paragem" class="w-full bg-transparent border-none focus:outline-none"><button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 remove-stop-btn">×</button>`;
          pageStopsContainer.appendChild(div);
          const input = document.getElementById(stopId);
          const madeiraBounds = new google.maps.LatLngBounds(new google.maps.LatLng(32.5, -17.3), new google.maps.LatLng(33.15, -16.25));
          setupAutocomplete(input, madeiraBounds);
        });
      }
      calculateAndDisplayRoute();

    } else {
      document.getElementById('event-start').value = 'Localização atual';
      document.getElementById('page-route-summary').textContent = 'Defina um percurso';
    }
    dashboardSection.classList.add('hidden');
    createEventPage.classList.remove('hidden');
  }
  function hideCreateEventPage() { createEventPage.classList.add('hidden'); dashboardSection.classList.remove('hidden'); createEventForm.reset(); document.getElementById('page-stops-container').innerHTML = ''; }
  document.getElementById('event-use-location').addEventListener('click', () => {
    followingUser = true;
    if (currentEventData.currentLocation) {
      map.setCenter(new google.maps.LatLng(currentEventData.currentLocation.lat, currentEventData.currentLocation.lng));
      document.getElementById('event-start').value = 'Localização atual';
      calculateAndDisplayRoute();
    }
  });

  document.getElementById('page-add-stop-btn').addEventListener('click', () => {
    const stopId = `page-stop-${pageStopsContainer.children.length}`;
    const div = document.createElement('div');
    div.className = 'p-4 rounded-lg border border-dashed border-brand-gray-700 relative';
    div.innerHTML = `<input type="text" id="${stopId}" placeholder="Adicionar paragem" class="w-full bg-transparent border-none focus:outline-none"><button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 remove-stop-btn">×</button>`;
    pageStopsContainer.appendChild(div);
    const input = document.getElementById(stopId);
    const madeiraBounds = new google.maps.LatLngBounds(new google.maps.LatLng(32.5, -17.3), new google.maps.LatLng(33.15, -16.25));
    setupAutocomplete(input, madeiraBounds);
    input.addEventListener('change', calculateAndDisplayRoute);
  });
  pageStopsContainer.addEventListener('click', e => { if (e.target.classList.contains('remove-stop-btn')) { e.target.parentElement.remove(); calculateAndDisplayRoute(); } });
  ['event-start', 'event-end'].forEach(id => document.getElementById(id).addEventListener('change', calculateAndDisplayRoute));

  createEventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pageTripError = document.getElementById('page-trip-error');
    pageTripError.textContent = '';

    let startLocationData = { description: document.getElementById('event-start').value };
    if (startLocationData.description.trim().toLowerCase().startsWith('localização atual')) {
      if (currentEventData.resolvedStartLocation) {
        startLocationData = currentEventData.resolvedStartLocation;
      } else if (currentEventData.currentLocation) {
        startLocationData = {
          description: 'Localização Atual',
          lat: currentEventData.currentLocation.lat,
          lng: currentEventData.currentLocation.lng
        };
      } else {
        pageTripError.textContent = 'Não foi possível obter a sua localização atual. Por favor, insira uma morada de partida.';
        return;
      }
    }

    const stops = Array.from(pageStopsContainer.querySelectorAll('input')).map(input => ({ description: input.value }));
    const tripData = {
      routeName: document.getElementById('event-title').value,
      startLocation: startLocationData,
      endLocation: { description: document.getElementById('event-end').value },
      stops,
      date: document.getElementById('event-datetime').value,
      durationText: currentEventData.durationText,
      distanceText: currentEventData.distanceText,
      isPublic: document.getElementById('event-public').checked
    };
    try {
      const method = editingTripId ? 'PUT' : 'POST';
      const url = editingTripId ? `${API_URL}/api/trips/${editingTripId}` : `${API_URL}/api/trips`;
      const res = await fetch(url, { method, headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(tripData) });
      const data = await res.json(); if (!res.ok) throw data;
      hideCreateEventPage();
      await refreshAllData();
    } catch (err) {
      pageTripError.textContent = (err.errors ? err.errors.map(e => e.msg).join(' ') : err.msg) || 'Ocorreu um erro ao guardar o evento.';
    }
  });

  // Listener global para cliques nos botões de cartão de evento (Editar, Apagar, Convidar)
  document.addEventListener('click', async (e) => {
    if (e.target.closest('.invite-trip-btn')) {
      e.stopPropagation();
      const inviteBtn = e.target.closest('.invite-trip-btn');
      const tripId = inviteBtn.dataset.id;
      await refreshFriends();
      openInviteModal(tripId);

      inviteSubmit.onclick = async () => {
        const token = localStorage.getItem('token'); if (!token) return;
        if (INVITE_SELECTED.size === 0) { alert('Selecione pelo menos um amigo.'); return; }
        try {
          const res = await fetch(`${API_URL}/api/trips/${tripId}/invite`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ inviteeIds: Array.from(INVITE_SELECTED) }) });
          const data = await res.json(); if (!res.ok) throw data;
          alert('Convites enviados ✅'); hideInviteModal();
        } catch (err) { alert(err?.msg || 'Erro a enviar convites.'); }
      };
      return;
    }
  });

  /* ===== Filtros ===== */
  document.getElementById('filter-btn').addEventListener('click', () => openModal(document.getElementById('filter-modal')));
  document.getElementById('filter-modal').addEventListener('click', e => { if (e.target.id === 'filter-modal') closeModal(document.getElementById('filter-modal')); });
  document.getElementById('apply-filters-btn').addEventListener('click', () => { closeModal(document.getElementById('filter-modal')); applyFilters(); });

  function applyFilters() {
    const active = {};
    document.querySelectorAll('.filter-checkbox').forEach(cb => active[cb.dataset.filter] = cb.checked);
    refilterList(publicEventsContent, PUBLIC_TRIPS_CACHE, active);
    refilterList(myEventsContent, MY_TRIPS_CACHE, active);
  }
  function refilterList(container, cache, active) {
    if (!cache) cache = [];
    const filteredTrips = cache.filter(trip => {
      const tripDate = new Date(trip.date), now = new Date();
      let status;
      if (tripDate < now && (tripDate.getTime() + 2 * 60 * 60 * 1000) < now.getTime()) { status = 'past'; }
      else if (tripDate < now) { status = 'active'; }
      else { status = 'upcoming'; }

      const isMine = (trip.user && CURRENT_USER && (trip.user._id === CURRENT_USER._id || trip.user === CURRENT_USER._id)) || (!trip.user && cache === MY_TRIPS_CACHE);

      if (isMine && !active.meus) return false;
      if (!isMine && !active.publicos) return false;
      if (!active[status]) return false;
      return true;
    });
    renderTrips(filteredTrips, container, container === publicEventsContent);
  }

  /* ===== Auth Principal ===== */
  const updateUI = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      dashboardSection.classList.add('hidden');
      authSection.classList.remove('hidden');
      return;
    }
    const ok = await fetchUserData();
    if (!ok) return;
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    await refreshAllData();
  };

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault(); authError.textContent = '';
    const body = { nome: document.getElementById('register-name').value, email: document.getElementById('register-email').value, password: document.getElementById('register-password').value };
    try {
      const res = await fetch(`${API_URL}/api/users/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw data;
      localStorage.setItem('token', data.token); await updateUI();
    } catch (err) { authError.textContent = (err.errors ? err.errors.map(e => e.msg).join(' ') : err.msg) || 'Ocorreu um erro no registo.'; }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); authError.textContent = '';
    const body = { email: document.getElementById('login-email').value, password: document.getElementById('login-password').value };
    try {
      const res = await fetch(`${API_URL}/api/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw data;
      localStorage.setItem('token', data.token); await updateUI();
    } catch (err) { authError.textContent = err.msg || 'Credenciais inválidas.'; }
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    FRIENDS_CACHE = []; OUTGOING_CACHE = []; INCOMING_CACHE = []; ALL_USERS_CACHE = [];
    CHAT_THREADS = []; MY_TRIPS_CACHE = []; PUBLIC_TRIPS_CACHE = []; CURRENT_USER = null;
    if (CHAT_POLL) clearInterval(CHAT_POLL);
    location.reload();
  });

  /* ===== Perfil + Cropper ===== */
  document.getElementById('change-picture-btn').addEventListener('click', () => document.getElementById('profile-picture-input').click());
  document.getElementById('profile-picture-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const tmp = await fileToJpegDataUrl(file, 2048, 0.95);
      cropState.img = new Image();
      cropState.img.onload = () => {
        cropState.zoom = 1; cropState.offsetX = 0; cropState.offsetY = 0;
        cropperImage.src = tmp;
        updateCropperTransform();
        cropperZoom.value = String(cropState.zoom);
        openModal(cropperModal);
      };
      cropState.img.src = tmp;
    } catch { alert('Não foi possível carregar a imagem.'); }
  });

  document.querySelector('.crop-viewport').addEventListener('mousedown', startDrag);
  window.addEventListener('mousemove', moveDrag);
  window.addEventListener('mouseup', endDrag);
  document.querySelector('.crop-viewport').addEventListener('touchstart', startDrag, { passive: true });
  window.addEventListener('touchmove', moveDrag, { passive: false });
  window.addEventListener('touchend', endDrag);
  cropperZoom.addEventListener('input', () => { cropState.zoom = parseFloat(cropperZoom.value || '1') || 1; updateCropperTransform(); });
  cropperCancel.addEventListener('click', () => closeModal(cropperModal));
  cropperSave.addEventListener('click', async () => {
    const size = 512;
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.translate(size / 2, size / 2);
    ctx.scale(cropState.zoom, cropState.zoom);
    ctx.drawImage(cropState.img, -cropState.img.width / 2 + cropState.offsetX, -cropState.img.height / 2 + cropState.offsetY);
    ctx.restore();
    const base64 = canvas.toDataURL('image/jpeg', 0.92);
    document.getElementById('profile-picture-preview').src = base64;
    closeModal(cropperModal);
    try {
      await fetch(`${API_URL}/api/users/profile`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ profilePicture: base64 }) });
    } catch { }
  });
  changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { currentPassword: document.getElementById('current-password').value, newPassword: document.getElementById('new-password').value };
    try {
      const res = await fetch(`${API_URL}/api/users/password`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw data;
      alert('Password alterada ✅'); changePasswordForm.classList.add('hidden'); changePasswordForm.reset();
    } catch (err) { alert(err?.msg || 'Não foi possível alterar a password.'); }
  });

  /* ===== Funções de Fetch ===== */
  async function fetchUserData() {
    const token = localStorage.getItem('token');
    if (!token) return false;
    try {
      const res = await fetch(`${API_URL}/api/users/me`, { headers: authHeaders() });
      const user = await res.json();
      if (!res.ok) throw user;
      welcomeMessage.textContent = user.nome;
      document.getElementById('profile-picture-preview').src = user.profilePicture || `https://placehold.co/96x96/1C1B22/E4E4E7?text=${user.nome?.charAt(0) || 'U'}`;
      userGarage = user.garage || [];
      CURRENT_USER = user;
      renderGarage();
      return true;
    } catch {
      localStorage.removeItem('token');
      dashboardSection.classList.add('hidden');
      authSection.classList.remove('hidden');
      return false;
    }
  }

  async function fetchTrips() {
    const token = localStorage.getItem('token'); if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/trips`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      MY_TRIPS_CACHE = await res.json();
      renderTrips(MY_TRIPS_CACHE, myEventsContent, false);
    } catch (e) { console.error("Erro ao buscar meus trips:", e); }
  }
  async function fetchPublicTrips() {
    try {
      const res = await fetch(`${API_URL}/api/trips/public`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      PUBLIC_TRIPS_CACHE = await res.json();
      renderTrips(PUBLIC_TRIPS_CACHE, publicEventsContent, true);
    } catch (e) { console.error("Erro ao buscar trips públicos:", e); }
  }
  function makeICSDataUrl(trip) {
    const dt = new Date(trip.date);
    const pad = n => String(n).padStart(2, '0');
    const toICS = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
    const dtstart = toICS(dt);
    const dtend = toICS(new Date(dt.getTime() + 2 * 60 * 60 * 1000));
    const desc = (trip.description || '').replace(/\n/g, '\\n');
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CrewGPS//PT
BEGIN:VEVENT
UID:${trip._id || (Math.random().toString(36).slice(2))}
DTSTAMP:${dtstart}
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${trip.routeName || 'Evento'}
DESCRIPTION:${desc}
END:VEVENT
END:VCALENDAR`;
    return 'data:text/calendar;charset=utf8,' + encodeURIComponent(ics);
  }

  function renderTrips(trips, container, isPublic = false) {
    container.innerHTML = '';
    if (!trips || trips.length === 0) {
      container.innerHTML = `<p class="text-brand-gray-200 text-center py-16">${isPublic ? 'Não há eventos públicos.' : 'Ainda não tem eventos.'}</p>`;
      return;
    }
    trips.forEach(trip => {
      const tripDate = new Date(trip.date), now = new Date();
      let status, statusColor, statusText;
      const eventEnd = new Date(tripDate.getTime() + (parseInt(trip.durationText) || 2) * 60 * 60 * 1000);
      if (now > eventEnd) {
        status = 'past'; statusColor = 'red'; statusText = 'Terminado';
      } else if (now >= tripDate && now <= eventEnd) {
        status = 'active'; statusColor = 'green'; statusText = 'Ativo';
      } else {
        status = 'upcoming'; statusColor = 'blue'; statusText = 'Próximo';
      }

      const isMine = (trip.user && CURRENT_USER && (trip.user._id === CURRENT_USER._id || trip.user === CURRENT_USER._id));
      const anfitriao = isMine ? 'Você' : (trip.user?.nome || 'Desconhecido');

      const isMultiStop = trip.stops && trip.stops.length > 0;
      const routeTypeText = isMultiStop ? "Multi-paragens" : "Direto";

      const wrap = document.createElement('div');
      wrap.setAttribute('data-trip', '1');
      wrap.setAttribute('data-status', status);
      wrap.setAttribute('data-mine', isMine.toString());
      wrap.className = `bg-brand-gray-800 border border-${statusColor}-500/50 p-4 rounded-xl flex justify-between items-start mb-4 cursor-pointer hover:bg-brand-gray-700 transition-colors`;

      wrap.dataset.tripData = JSON.stringify(trip);
      wrap.addEventListener('click', (e) => {
        if (!e.target.closest('.invite-trip-btn, a[download]')) {
          openEventDetailsModal(trip);
        }
      });

      const calendarIcon = `
        <a href="${makeICSDataUrl(trip)}" download="evento_${trip.routeName || trip._id}.ics"
           class="text-brand-gray-200 hover:text-blue-400 transition-colors"
           title="Adicionar ao calendário"
           onclick="event.stopPropagation()">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V2h8V.5a.5.5 0 0 1 1 0V2h.5A1.5 1.5 0 0 1 15 3.5V5H1V3.5A1.5 1.5 0 0 1 2.5 2H3V.5a.5.5 0 0 1 .5-.5z"/><path d="M1 6h14v6.5A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5V6z"/></svg>
        </a>`;

      const tools = isMine ? `
      <div class="flex flex-col gap-2 pl-4 border-l border-brand-gray-700 ml-4 flex-shrink-0">
        <button data-id="${trip._id}" class="invite-trip-btn text-brand-gray-200 hover:text-purple-400 transition-colors" title="Convidar amigos">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M10 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/><path d="M14 8s-1-1-4-1-4 1-4 1-1 0-1 1 1 3 5 3 5-2 5-3-1-1-1-1z"/></svg>
        </button>
      </div>` : '';

      const participantCount = trip.participants?.length || 0;

      wrap.innerHTML = `
      <div class="flex-grow min-w-0">
        <div class="flex justify-between items-start">
          <div class="min-w-0">
            <h3 class="font-semibold text-white truncate">${trip.routeName}</h3>
            <p class="text-xs text-brand-gray-200">Anfitrião: ${anfitriao}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0 ml-2">
            ${calendarIcon}
            <span class="bg-${statusColor}-500/20 text-${statusColor}-400 text-xs font-bold px-2 py-1 rounded-full">${statusText}</span>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-2 text-center my-4">
          <div class="flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="mb-1" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg><p class="text-xs text-brand-gray-200">${(trip.stops?.length || 0) + 2} Locais</p></div>
          <div class="flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="mb-1" viewBox="0 0 16 16" fill="currentColor"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-6.468 4H8v3H1.056A7 7 0 1 0 8 1z"/></svg><p class="text-xs text-brand-gray-200">${participantCount} Particip.</p></div>
          <div class="flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="mb-1" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg><p class="text-xs text-brand-gray-200">${trip.durationText || 'N/D'}</p></div>
          <div class="flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="mb-1" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4 4a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zM.5 8a.5.5 0 0 1 .5-.5h14a.5.5 0 0 1 0 1H1a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5z"/></svg><p class="text-xs text-brand-gray-200"> ${isMultiStop ? 'Multi-paragens' : 'Direto'} </p></div>
        </div>
        <p class="text-xs text-brand-gray-200 text-center">${new Date(trip.date).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</p>
      </div>
      ${tools}
      `;
      container.appendChild(wrap);
    });
  }

  /* ===== Social ===== */
  async function refreshFriends() {
    const token = localStorage.getItem('token'); if (!token) return;
    try {
      const [fr, out, inc] = await Promise.all([
        fetch(`${API_URL}/api/friends/list`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API_URL}/api/friends/requests/outgoing`, { headers: authHeaders() }).then(r => r.json()).catch(() => []),
        fetch(`${API_URL}/api/friends/requests/incoming`, { headers: authHeaders() }).then(r => r.json()).catch(() => [])
      ]);
      FRIENDS_CACHE = Array.isArray(fr) ? fr : [];
      OUTGOING_CACHE = Array.isArray(out) ? out : [];
      INCOMING_CACHE = Array.isArray(inc) ? inc : [];
    } catch (e) { console.error("Erro ao buscar amigos:", e); }
  }
  function getOutgoingRequestId(userId) {
    const req = OUTGOING_CACHE.find(r => (r.to === userId) || (r.to && r.to._id === userId));
    return req ? req._id : null;
  }
  function relationshipFor(userId) {
    if (FRIENDS_CACHE.some(u => u._id === userId)) return 'friends';
    if (OUTGOING_CACHE.some(r => r.to === userId || r.to?._id === userId)) return 'outgoing';
    if (INCOMING_CACHE.some(r => r.from === userId || r.from?._id === userId)) return 'incoming';
    return 'none';
  }

  let socialSearchTimer = null;
  userSearchInput?.addEventListener('input', () => {
    clearTimeout(socialSearchTimer);
    socialSearchTimer = setTimeout(async () => {
      await refreshFriends();
      searchUsers(userSearchInput.value);
    }, 250);
  });

  async function searchUsers(q) {
    const token = localStorage.getItem('token');
    const query = (q || '').trim();
    if (query.length < 2) { userSearchResults.innerHTML = ''; return; }
    try {
      let res = await fetch(`${API_URL}/api/users/search?query=${encodeURIComponent(query)}`, { headers: authHeaders() });
      if (!res.ok) {
        res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
      }
      const data = await res.json();
      if (!res.ok) throw data;
      renderUserSearch(Array.isArray(data) ? data : []);
    } catch {
      userSearchResults.innerHTML = '<p class="text-sm text-red-400">Erro a pesquisar utilizadores.</p>';
    }
  }

  function renderUserSearch(users) {
    userSearchResults.innerHTML = '';
    if (!users || !users.length) {
      userSearchResults.innerHTML = '<p class="text-sm text-brand-gray-200">Sem resultados.</p>';
      return;
    }
    users.forEach(user => {
      if (CURRENT_USER && user._id === CURRENT_USER._id) return;
      const rel = relationshipFor(user._id);
      let actionBtn = '';
      if (rel === 'friends') {
        actionBtn = `<button class="friend-chip bg-brand-gray-700 text-white text-sm font-semibold px-3 py-1.5 rounded" data-user-id="${user._id}">Amigo ✓</button>`;
      } else if (rel === 'outgoing') {
        const reqId = getOutgoingRequestId(user._id) || '';
        actionBtn = `<button class="cancel-request-btn bg-brand-gray-700 hover:bg-brand-gray-600 text-white text-sm font-semibold px-3 py-1.5 rounded" data-request-id="${reqId}" data-user-id="${user._id}">Cancelar pedido</button>`;
      } else if (rel === 'incoming') {
        actionBtn = `<span class="text-sm font-semibold text-blue-400">Responder</span>`;
      } else {
        actionBtn = `<button class="send-friend-btn bg-brand-purple hover:bg-opacity-90 text-white text-sm font-semibold px-3 py-1.5 rounded" data-user-id="${user._id}">Adicionar</button>`;
      }
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between bg-brand-gray-800 border border-brand-gray-700 rounded-lg p-3';
      row.innerHTML = `
      <div class="flex items-center gap-3">
        <img src="${user.profilePicture || 'https://placehold.co/40x40/1C1B22/E4E4E7?text=' + (user.nome?.[0] || 'U')}" class="w-10 h-10 rounded-full object-cover" alt="">
        <div><p class="text-white font-semibold">${user.nome}</p></div>
      </div>
      <div>${actionBtn}</div>
      `;
      userSearchResults.appendChild(row);
    });
  }

  userSearchResults.addEventListener('click', async (e) => {
    const addBtn = e.target.closest('.send-friend-btn');
    const cancelBtn = e.target.closest('.cancel-request-btn');
    const unfBtn = e.target.closest('.friend-chip');
    if (addBtn) {
      const toUserId = addBtn.dataset.userId;
      try {
        const res = await fetch(`${API_URL}/api/friends/requests`, {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ toUserId, to: toUserId })
        });
        const data = await res.json(); if (!res.ok) throw data;
        let reqId = data?._id || data?.requestId || data?.request?._id || null;
        if (!reqId) { await refreshFriends(); reqId = getOutgoingRequestId(toUserId); }
        if (reqId) {
          addBtn.outerHTML = `<button class="cancel-request-btn bg-brand-gray-700 hover:bg-brand-gray-600 text-white text-sm font-semibold px-3 py-1.5 rounded" data-request-id="${reqId}" data-user-id="${toUserId}">Cancelar pedido</button>`;
        } else {
          addBtn.outerHTML = `<button class="cancel-request-btn bg-brand-gray-700 hover:bg-brand-gray-600 text-white text-sm font-semibold px-3 py-1.5 rounded" data-request-id="" data-user-id="${toUserId}">Cancelar pedido</button>`;
        }
        await updateBadges();
      } catch (err) { alert(err?.msg || 'Não foi possível enviar o pedido.'); }
    }
    if (cancelBtn) {
      let requestId = cancelBtn.dataset.requestId || '';
      const toUserId = cancelBtn.dataset.userId;
      try {
        if (!requestId) { await refreshFriends(); requestId = getOutgoingRequestId(toUserId); }
        if (!requestId) throw { msg: 'Pedido não encontrado.' };
        const res = await fetch(`${API_URL}/api/friends/requests/${requestId}`, { method: 'DELETE', headers: authHeaders() });
        const data = await res.json(); if (!res.ok) throw data;
        await refreshFriends();
        searchUsers(userSearchInput.value);
        await updateBadges();
      } catch (err) { alert(err?.msg || 'Não foi possível cancelar o pedido.'); }
    }
    if (unfBtn) {
      const id = unfBtn.dataset.userId;
      const friend = FRIENDS_CACHE.find(f => f._id === id);
      if (friend) openUnfriendModal(friend);
    }
  });

  async function fetchIncomingInvites() {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/friends/requests/incoming`, { headers: authHeaders() });
      const list = await res.json(); if (!res.ok) throw list;
      INCOMING_CACHE = Array.isArray(list) ? list : [];
      renderInvites(INCOMING_CACHE);
    } catch { invitesList.innerHTML = '<p class="text-sm text-red-400 p-4">Erro a carregar convites.</p>'; }
  }
  function renderInvites(list) {
    invitesList.innerHTML = '';
    if (!list || list.length === 0) {
      invitesList.innerHTML = '<div class="text-center py-12"><p class="text-brand-gray-200">Sem pedidos pendentes.</p></div>'; return;
    }
    list.forEach(fr => {
      const card = document.createElement('div');
      card.className = 'bg-brand-gray-800 border border-brand-gray-700 rounded-lg p-4 mb-3 flex items-center justify-between';
      card.innerHTML = `
      <div class="flex items-center gap-3">
        <img src="${fr.from?.profilePicture || 'https://placehold.co/40x40/1C1B22/E4E4E7?text=' + (fr.from?.nome?.[0] || 'U')}" class="w-10 h-10 rounded-full object-cover" alt="">
        <div><p class="text-white font-semibold">${fr.from?.nome || 'Utilizador'}</p><p class="text-xs text-brand-gray-200">quer adicionar-te</p></div>
      </div>
      <div class="flex gap-2">
        <button class="accept-invite bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-3 py-1.5 rounded" data-id="${fr._id}" type="button">Aceitar</button>
        <button class="reject-invite bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-3 py-1.5 rounded" data-id="${fr._id}" type="button">Rejeitar</button>
      </div>`;
      invitesList.appendChild(card);
    });
  }
  invitesList.addEventListener('click', async (e) => {
    const acc = e.target.closest('.accept-invite'), rej = e.target.closest('.reject-invite');
    if (acc) {
      const id = acc.dataset.id;
      try {
        const r = await fetch(`${API_URL}/api/friends/requests/${id}/accept`, { method: 'POST', headers: authHeaders() });
        const d = await r.json(); if (!r.ok) throw d;
        await refreshAllData();
      } catch (err) { alert(err?.msg || 'Erro ao aceitar.'); }
    }
    if (rej) {
      const id = rej.dataset.id;
      try {
        const r = await fetch(`${API_URL}/api/friends/requests/${id}/reject`, { method: 'POST', headers: authHeaders() });
        const d = await r.json(); if (!r.ok) throw d;
        await refreshAllData();
      } catch (err) { alert(err?.msg || 'Erro ao rejeitar.'); }
    }
  });

  /* ===== Chat ===== */
  async function fetchAllUsers() {
    const token = localStorage.getItem('token');
    if (!token) return;
    ALL_USERS_CACHE = [];
    try {
      const res = await fetch(`${API_URL}/api/users/all`, { headers: authHeaders() });
      if (res.ok) {
        let data = await res.json();
        if (Array.isArray(data?.users)) data = data.users;
        ALL_USERS_CACHE = Array.isArray(data) ? data : [];
      }
    } catch (err) {
      console.error("Falha ao obter todos os utilizadores:", err);
      ALL_USERS_CACHE = FRIENDS_CACHE.slice();
    }
  }

  async function fetchChatThreads() {
    const token = localStorage.getItem('token');
    CHAT_THREADS = [];
    try {
      const res = await fetch(`${API_URL}/api/chat/threads`, { headers: authHeaders() });
      if (res.ok) CHAT_THREADS = await res.json();
    } catch (e) { console.error("Erro a carregar threads:", e); }
  }

  function addLongPressToRow(row, user) {
    let timer;
    const hold = 550;
    const start = () => {
      timer = setTimeout(() => {
        if (confirm(`Ocultar conversa com ${user.nome || 'utilizador'}?`)) {
          HIDDEN_THREADS.add(user._id);
          localStorage.setItem('hiddenThreads', JSON.stringify([...HIDDEN_THREADS]));
          renderChatThreads();
          updateBadges();
        }
      }, hold);
    };
    const cancel = () => clearTimeout(timer);
    row.addEventListener('mousedown', start);
    row.addEventListener('touchstart', start, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => row.addEventListener(ev, cancel));
  }

  function initializeUnhideModalLogic() {
    const unhideModal = document.getElementById('unhide-modal');
    const showBtn = document.getElementById('show-hidden-chats-btn');
    const closeBtn = document.getElementById('unhide-close-btn');
    const hiddenList = document.getElementById('hidden-chats-list');

    function renderHiddenChats() {
      hiddenList.innerHTML = '';
      if (!ALL_USERS_CACHE) {
        hiddenList.innerHTML = '<p class="text-sm text-brand-gray-200 text-center">A carregar...</p>';
        return;
      }
      const hiddenUsers = ALL_USERS_CACHE.filter(u => HIDDEN_THREADS.has(u._id));
      if (hiddenUsers.length === 0) {
        hiddenList.innerHTML = '<p class="text-sm text-brand-gray-200 text-center">Não há conversas ocultas.</p>';
        return;
      }
      hiddenUsers.forEach(user => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-brand-gray-900 p-3 rounded-lg';
        row.innerHTML = `
        <div class="flex items-center gap-3">
          <img src="${user.profilePicture || `https://placehold.co/40x40/1C1B22/E4E4E7?text=${(user.nome?.[0] || 'U')}`}" class="w-10 h-10 rounded-full object-cover" alt="">
          <span class="font-semibold">${user.nome}</span>
        </div>
        <button class="unhide-btn bg-brand-purple text-white text-sm font-semibold px-3 py-1.5 rounded" data-user-id="${user._id}">Mostrar</button>
       `;
        hiddenList.appendChild(row);
      });
    }
    showBtn.addEventListener('click', () => {
      renderHiddenChats();
      openModal(unhideModal);
    });
    closeBtn.addEventListener('click', () => closeModal(unhideModal));
    unhideModal.addEventListener('click', e => { if (e.target === unhideModal) closeModal(unhideModal); });
    hiddenList.addEventListener('click', e => {
      const unhideBtn = e.target.closest('.unhide-btn');
      if (unhideBtn) {
        const userId = unhideBtn.dataset.userId;
        HIDDEN_THREADS.delete(userId);
        localStorage.setItem('hiddenThreads', JSON.stringify([...HIDDEN_THREADS]));
        renderHiddenChats();
        renderChatThreads();
      }
    });
  }

  // ** NOVO: Função de Pesquisa no Chat **
  function renderChatSearch(list) {
    chatSearchResults.innerHTML = '';
    if (!list.length) return;
    list.forEach(u => {
      const row = document.createElement('button');
      row.className = 'chat-row w-full text-left';
      const avatar = u.profilePicture || `https://placehold.co/44x44/1C1B22/E4E4E7?text=${(u.nome?.[0] || 'U')}`;
      row.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="primary truncate">${u.nome || 'Utilizador'}</div>
        <div class="secondary">Abrir conversa</div>
      </div>
      <div class="middle-dot"><div>&nbsp;</div><div class="ago"></div></div>
      <img src="${avatar}" class="w-11 h-11 rounded-full object-cover" alt="">
      `;
      row.addEventListener('click', () => {
        chatSearchResults.innerHTML = '';
        chatSearchInput.value = '';
        openChatWith(u);
      });
      chatSearchResults.appendChild(row);
    });
  }
  let chatSearchTimer = null;
  chatSearchInput?.addEventListener('input', () => {
    clearTimeout(chatSearchTimer);
    chatSearchTimer = setTimeout(() => {
      const q = (chatSearchInput.value || '').toLowerCase().trim();
      if (!q) { chatSearchResults.innerHTML = ''; return; }
      const res = FRIENDS_CACHE.filter(f => (f.nome || '').toLowerCase().includes(q));
      renderChatSearch(res.slice(0, 20));
    }, 180);
  });

  async function renderChatThreads() {
    chatUsersList.innerHTML = '';
    if (!Array.isArray(CHAT_THREADS)) {
      console.warn("CHAT_THREADS ainda não carregado.");
      chatUsersList.innerHTML = '<p class="text-sm text-brand-gray-200 text-center py-10">A carregar conversas...</p>';
      return;
    }
    const visibleThreads = CHAT_THREADS.filter(thread =>
      thread.user && thread.user._id && !HIDDEN_THREADS.has(thread.user._id)
    );
    if (visibleThreads.length === 0) {
      chatUsersList.innerHTML = '<p class="text-sm text-brand-gray-200 text-center py-10">Sem conversas ativas. Pesquise amigos para começar!</p>';
      return;
    }
    visibleThreads.sort((a, b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0));
    visibleThreads.forEach(thread => {
      const user = thread.user;
      const lastText = (thread.lastMessage?.text || '').trim();
      const lastAt = thread.lastMessage?.createdAt || null;
      const unread = (thread.unreadCount || 0) > 0;
      const avatar = user.profilePicture || `https://placehold.co/44x44/1C1B22/E4E4E7?text=${(user.nome?.[0] || 'U')}`;
      const row = document.createElement('button');
      row.className = 'chat-row w-full text-left';
      row.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="primary truncate">${user.nome || 'Utilizador'}</div>
        <div class="secondary">${lastText || '—'}</div>
      </div>
      <div class="middle-dot">
        <div>${unread ? '•' : '&nbsp;'}</div>
        <div class="ago">${lastAt ? timeAgo(lastAt) : ''}</div>
      </div>
      <img src="${avatar}" class="w-11 h-11 rounded-full object-cover" alt="">
      `;
      row.addEventListener('click', () => openChatWith(user));
      addLongPressToRow(row, user);
      chatUsersList.appendChild(row);
    });
  }

  function renderMessages(msgs) {
    convoMessages.innerHTML = '';
    if (!Array.isArray(msgs)) return;
    const theirAvatar = ACTIVE_CHAT_FRIEND?.profilePicture || `https://placehold.co/22x22/1C1B22/E4E4E7?text=${(ACTIVE_CHAT_FRIEND?.nome?.[0] || 'U')}`;
    let lastOutIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].fromMe) { lastOutIdx = i; break; } }

    msgs.forEach((m, i) => {
      const mine = !!m.fromMe;
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const isLastOfGroup = !next || !!next.fromMe !== mine;
      const isNewSender = !prev || !!prev.fromMe !== mine;
      const group = document.createElement('div');
      group.className = `chat-group ${mine ? 'me' : 'them'} ${isLastOfGroup ? 'is-last' : ''}`;
      if (isNewSender && i > 0) { group.style.marginTop = '12px'; }
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${mine ? 'chat-me' : 'chat-them'}`;
      bubble.textContent = m.text || '';
      const avatar = document.createElement('img');
      avatar.className = 'chat-avatar';
      avatar.src = theirAvatar;
      avatar.alt = '';
      if (mine) {
        group.appendChild(bubble);
      } else {
        group.appendChild(avatar);
        group.appendChild(bubble);
      }
      convoMessages.appendChild(group);
      if (i === lastOutIdx) {
        const r = document.createElement('div');
        r.className = 'chat-receipt';
        r.textContent = m.seen ? '✓✓ Visto' : '✓ Enviado';
        convoMessages.appendChild(r);
      }
    });
    convoMessages.scrollTop = convoMessages.scrollHeight;
  }

  async function loadMessages() {
    if (!ACTIVE_CHAT_FRIEND) return;
    try {
      const res = await fetch(`${API_URL}/api/chat/${ACTIVE_CHAT_FRIEND._id}/messages`, { headers: authHeaders() });
      const list = await res.json(); if (!res.ok) throw list;
      const meMsgs = (Array.isArray(list) ? list : []).map(m => ({
        _id: m._id,
        text: m.text,
        createdAt: m.createdAt,
        fromMe: m.fromMe || (m.from === CURRENT_USER?._id),
        seen: !!(m.seen || m.readAt)
      }));
      renderMessages(meMsgs);
    } catch (err) { console.error("Erro ao carregar mensagens:", err); }
  }

  async function openChatWith(user) {
    ACTIVE_CHAT_FRIEND = user;
    convoAvatar.src = user.profilePicture || `https://placehold.co/32x32/1C1B22/E4E4E7?text=${(user.nome?.[0] || 'U')}`;
    convoUsername.textContent = user.nome || 'Utilizador';
    convoInput.value = '';
    renderMessages([]);
    openModal(convoPage);

    const threadInCache = CHAT_THREADS.find(t => t.userId === user._id || t.user?._id === user._id);
    if (threadInCache) {
      threadInCache.unreadCount = 0;
    }
    await updateBadges();
    await renderChatThreads();

    await loadMessages();
    await markThreadRead(user._id);

    await fetchChatThreads();
    await renderChatThreads();
    await updateBadges();

    if (CHAT_POLL) clearInterval(CHAT_POLL);
    CHAT_POLL = setInterval(async () => {
      if (document.hidden || !ACTIVE_CHAT_FRIEND) return;
      await loadMessages();
      await fetchChatThreads();
      await renderChatThreads();
      await updateBadges();
      if (ACTIVE_CHAT_FRIEND) await markThreadRead(ACTIVE_CHAT_FRIEND._id);
    }, 5000);
  }

  convoBackBtn.addEventListener('click', () => { closeModal(convoPage); if (CHAT_POLL) { clearInterval(CHAT_POLL); CHAT_POLL = null; ACTIVE_CHAT_FRIEND = null; } });
  convoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ACTIVE_CHAT_FRIEND) return;
    const text = convoInput.value.trim(); if (!text) return;
    convoInput.value = '';
    try {
      const res = await fetch(`${API_URL}/api/chat/${ACTIVE_CHAT_FRIEND._id}/messages`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text }) });
      const data = await res.json(); if (!res.ok) throw data;
      await Promise.all([loadMessages(), fetchChatThreads()]);
      await renderChatThreads();
      await updateBadges();
    } catch { alert('Não foi possível enviar.'); convoInput.value = text; }
  });

  /* ===== Friends Page (em Conta) ===== */
  openFriendsPageBtn.addEventListener('click', async () => { await refreshFriends(); renderFriendsPage(); openModal(friendsPage); });
  friendsBackBtn.addEventListener('click', () => closeModal(friendsPage));
  friendsPage.addEventListener('click', (e) => { if (e.target === friendsPage) closeModal(friendsPage); });
  function renderFriendsPage() {
    friendsPageList.innerHTML = '';
    if (!FRIENDS_CACHE.length) { friendsPageList.innerHTML = '<p class="text-sm text-brand-gray-200">Sem amigos.</p>'; return; }
    FRIENDS_CACHE.forEach(f => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between bg-brand-gray-800 border border-brand-gray-700 rounded-lg p-3';
      row.innerHTML = `
      <div class="flex items-center gap-3">
        <img src="${f.profilePicture || 'https://placehold.co/40x40/1C1B22/E4E4E7?text=' + (f.nome?.[0] || 'U')}" class="w-10 h-10 rounded-full object-cover" alt="">
        <div><p class="text-white font-semibold">${f.nome}</p></div>
      </div>
      <div class="flex gap-2">
        <button class="friend-message-btn px-3 py-1.5 rounded bg-brand-purple text-white text-sm" data-user-id="${f._id}">Mensagem</button>
        <button class="friend-remove-btn px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm" data-user-id="${f._id}">Remover</button>
      </div>
      `;
      friendsPageList.appendChild(row);
    });
  }
  friendsPageList.addEventListener('click', (e) => {
    const rm = e.target.closest('.friend-remove-btn');
    const msg = e.target.closest('.friend-message-btn');
    if (rm) {
      const id = rm.dataset.userId;
      const friend = FRIENDS_CACHE.find(f => f._id === id);
      if (friend) openUnfriendModal(friend);
    }
    if (msg) {
      const id = msg.dataset.userId;
      const friend = FRIENDS_CACHE.find(f => f._id === id);
      if (friend) { closeModal(friendsPage); document.querySelector(`footer .nav-btn[data-view="3"]`).click(); openChatWith(friend); }
    }
  });

  /* ===== Grupos ===== */
  async function fetchMyGroups() {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/groups`, { headers: authHeaders() });
      const data = await res.json(); if (!res.ok) throw data;
      renderGroupsList(Array.isArray(data) ? data : []);
    } catch { renderGroupsList([]); }
  }
  function renderGroupsList(list) {
    myGroupsList.innerHTML = '';
    if (!list.length) { myGroupsList.innerHTML = '<p class="text-sm text-brand-gray-200">Ainda sem grupos.</p>'; return; }
    list.forEach(g => {
      const b = document.createElement('button');
      b.className = 'w-full flex items-center justify-between px-2 py-2 rounded hover:bg-brand-gray-700 text-left';
      b.innerHTML = `<span class="text-sm font-semibold">${g.name}</span><span class="text-xs text-brand-gray-200">${g.membersCount || 1} membros</span>`;
      b.addEventListener('click', () => selectGroup(g));
      myGroupsList.appendChild(b);
    });
  }
  function selectGroup(g) {
    groupSelected.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h3 class="font-semibold">${g.name}</h3>
        <p class="text-sm text-brand-gray-200">${g.description || ''}</p>
      </div>
      <button class="px-3 py-1 rounded bg-brand-purple text-white text-sm" id="group-invite-btn" type="button">Convidar</button>
    </div>
    <div class="mt-3 text-sm text-brand-gray-200">Chat e posts do grupo (a integrar) …</div>
    `;
    document.getElementById('group-invite-btn')?.addEventListener('click', async () => {
      await refreshFriends();
      INVITE_TRIP_ID = null;
      openModal(inviteModal);
      inviteSubmit.onclick = async () => {
        const token = localStorage.getItem('token');
        if (INVITE_SELECTED.size === 0) return alert("Selecione pelo menos um amigo.");
        try {
          const res = await fetch(`${API_URL}/api/groups/${g._id}/invite`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ userIds: Array.from(INVITE_SELECTED) }) });
          const data = await res.json(); if (!res.ok) throw data;
          alert('Convites enviados ✅'); INVITE_SELECTED.clear(); closeModal(inviteModal);
        } catch (err) { alert(err?.msg || 'Erro a convidar.'); }
      };
    });
  }
  createGroupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: groupNameInput.value, description: groupDescInput.value };
    try {
      const res = await fetch(`${API_URL}/api/groups`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw data;
      groupNameInput.value = ''; groupDescInput.value = '';
      await fetchMyGroups();
      alert('Grupo criado ✅');
    } catch (err) { alert(err?.msg || 'Não foi possível criar o grupo.'); }
  });
  async function searchGroups(q) {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/groups/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
      const data = await res.json(); if (!res.ok) throw data;
      renderGroupSearch(Array.isArray(data) ? data : []);
    } catch { renderGroupSearch([]); }
  }
  groupSearchBtn.addEventListener('click', async (e) => { e.preventDefault(); await searchGroups(groupSearchInput.value || ''); });
  function renderGroupSearch(list) {
    groupSearchResults.innerHTML = '';
    if (!list.length) { groupSearchResults.innerHTML = '<p class="text-sm text-brand-gray-200">Sem resultados.</p>'; return; }
    list.forEach(g => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between bg-brand-gray-800 border border-brand-gray-700 rounded-lg p-3';
      const joinBtn = `<button class="join-group bg-brand-purple hover:bg-opacity-90 text-white text-sm font-semibold px-3 py-1.5 rounded" data-id="${g._id}" type="button">Juntar-me</button>`;
      row.innerHTML = `<div><p class="text-white font-semibold">${g.name}</p><p class="text-xs text-brand-gray-200">${g.description || ''}</p></div>${joinBtn}`;
      groupSearchResults.appendChild(row);
    });
  }
  groupSearchResults.addEventListener('click', async (e) => {
    const join = e.target.closest('.join-group'); if (!join) return;
    const id = join.dataset.id;
    try {
      const res = await fetch(`${API_URL}/api/groups/${id}/join`, { method: 'POST', headers: authHeaders() });
      const data = await res.json(); if (!res.ok) throw data;
      await fetchMyGroups();
      alert('Pedido enviado/aderiu ao grupo ✅');
    } catch (err) { alert(err?.msg || 'Não foi possível aderir.'); }
  });

  /* ===== Badges ===== */
  async function updateBadges() {
    const invites = INCOMING_CACHE?.length || 0;
    setBadge(badgeSocialEl, invites);

    if (Array.isArray(CHAT_THREADS)) {
      const unreadThreads = CHAT_THREADS.filter(t => (t.unreadCount || 0) > 0).length;
      setBadge(badgeChatEl, unreadThreads);
    } else {
      try {
        const res = await fetch(`${API_URL}/api/chat/unread`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          const m = Number(data?.count || 0);
          setBadge(badgeChatEl, m > 0 ? 1 : 0);
        }
      } catch { }
    }
  }
  async function refreshAllData() {
    console.log("Refreshing all data...");
    try {
      await Promise.allSettled([
        fetchUserData(),
        refreshFriends(),
        fetchIncomingInvites(),
        fetchAllUsers(),
        fetchChatThreads(),
        fetchTrips(),
        fetchPublicTrips(),
        fetchMyGroups()
      ]);

      renderGarage();
      renderInvites(INCOMING_CACHE);
      applyFilters();
      await renderChatThreads();
      await updateBadges();
      console.log("Refresh complete.");

    } catch (error) { console.error("Error during global refresh orchestration:", error); }
  }

  enablePTR(document.getElementById('events-view'), document.getElementById('ptr-events'), refreshAllData);
  enablePTR(document.getElementById('social-view'), document.getElementById('ptr-social'), refreshAllData);
  enablePTR(document.getElementById('chat-view'), document.getElementById('ptr-chat'), refreshAllData);
  enablePTR(document.getElementById('account-view'), document.getElementById('ptr-account'), refreshAllData);
  createEventFab.addEventListener('click', () => showCreateEventPage());
  backFromCreateBtn.addEventListener('click', () => hideCreateEventPage());
  initializeUnhideModalLogic();
  updateUI();

  /* ===== MODO MAPA: Conduzir / Vista Geral (revisto) ===== */
  (function () {
    const toggleBtn = document.getElementById('map-mode-toggle');
    const iconEl   = document.getElementById('map-mode-icon');

    // defaults
    window.DRIVING_MODE = (window.DRIVING_MODE ?? true);
    window.DEFAULT_ZOOM = 17; // mais próximo em conduzir
    window.followingUser = true;

    // guardamos a câmara da vista geral para restaurar quando saímos de conduzir
    let savedExploreCamera = null;
    // track do último gesture do utilizador
    let userGesture = false;

    function renderModeButton() {
      if (!iconEl) return;
      iconEl.textContent = window.DRIVING_MODE ? 'navigation' : 'explore';
      toggleBtn?.setAttribute('aria-pressed', window.DRIVING_MODE ? 'true' : 'false');
    }

    function saveExploreCamera() {
      if (!map) return;
      try {
        const c = map.getCenter();
        savedExploreCamera = {
          center: c ? { lat: c.lat(), lng: c.lng() } : null,
          zoom: map.getZoom(),
          heading: (typeof map.getHeading === 'function') ? (map.getHeading() || 0) : 0,
          tilt: (typeof map.getTilt === 'function') ? (map.getTilt() || 0) : 0
        };
      } catch {}
    }

    function restoreExploreCamera() {
      if (!map || !savedExploreCamera) return;
      try {
        if (savedExploreCamera.center) map.panTo(savedExploreCamera.center);
        if (savedExploreCamera.zoom != null) map.setZoom(savedExploreCamera.zoom);
        setCamera(0, 0); // vista geral sem tilt/heading
      } catch {}
    }

    function centerOnUserIfPossible() {
      const loc = window.currentEventData?.currentLocation;
      if (!map || !loc) return;
      const ll = new google.maps.LatLng(loc.lat, loc.lng);
      map.panTo(ll);
      if ((map.getZoom() || 0) < window.DEFAULT_ZOOM) map.setZoom(window.DEFAULT_ZOOM);
    }

    function applyMapMode({ centerNow = true } = {}) {
      if (!map) { renderModeButton(); return; }

      if (window.DRIVING_MODE) {
        // ao entrar em conduzir, guardamos estado atual da vista geral
        saveExploreCamera();
        window.followingUser = true;
        if (centerNow) centerOnUserIfPossible();
        // aplica tilt/heading atuais (se já tivermos heading calculado)
        const hdg = window.__lastHeading ?? 0;
        setCamera(hdg, 50);
      } else {
        // vista geral: parar de seguir e repor tilt/heading
        window.followingUser = false;
        setCamera(0, 0);
        if (centerNow) restoreExploreCamera();
      }

      renderModeButton();
    }

    function setModeDriving(isDriving, { centerNow = true } = {}) {
      if (window.DRIVING_MODE === isDriving) {
        if (isDriving && centerNow) centerOnUserIfPossible();
        renderModeButton();
        return;
      }
      window.DRIVING_MODE = isDriving;
      applyMapMode({ centerNow });
    }

    // Expõe globalmente para outros handlers
    window.setModeDriving = setModeDriving;
    window.applyMapMode = () => applyMapMode({ centerNow: true });
    window.wireMapInteractionDetectors = wireMapInteractionDetectors;

    // botão da UI
    toggleBtn?.addEventListener('click', () => {
      setModeDriving(!window.DRIVING_MODE, { centerNow: true });
    });

    // ligar listeners de interação (desativam conduzir ao gesto)
    let wired = false;
    function wireMapInteractionDetectors() {
      if (wired || !map) return;
      wired = true;

      const mapEl = document.getElementById('map');
      ['pointerdown', 'touchstart', 'wheel'].forEach(evt => {
        mapEl?.addEventListener(evt, () => { userGesture = true; }, { passive: true });
      });

      map.addListener('dragstart', () => {
        if (window.DRIVING_MODE) setModeDriving(false, { centerNow: false });
      });

      map.addListener('zoom_changed', () => {
        if (userGesture && window.DRIVING_MODE) {
          setModeDriving(false, { centerNow: false });
        }
        userGesture = false;
      });

      map.addListener('idle', () => { userGesture = false; });
    }

    // embrulhar a tua init original para garantir wiring e aplicação do modo
    const originalInit = window.__actualInitMap;
    window.__actualInitMap = function () {
      if (typeof originalInit === 'function') originalInit();
      wireMapInteractionDetectors();
      renderModeButton();
      applyMapMode({ centerNow: true });
    };

    // se o mapa já existir por algum motivo
    if (window.map) {
      wireMapInteractionDetectors();
      renderModeButton();
      applyMapMode({ centerNow: false });
    }
  })();

  /* ========= HUD: setters ========= */
  function setSpeed(v) {
    const n = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    const el = document.getElementById('speedValue');
    if (el) el.textContent = n;
  }
  function setSpeedLimit(v) {
    const badge = document.getElementById('speedLimitBadge');
    const val = document.getElementById('speedLimitValue');
    if (!badge || !val) return;
    if (v == null) {
      badge.style.display = 'none';
    } else {
      val.textContent = v;
      badge.style.display = '';
    }
  }

  /* ========= util: distância em metros (haversine) ========= */
  function metersBetween(a, b) {
    const toRad = d => d * Math.PI / 180;
    const R = 6371000;
    const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
    const Δφ = toRad(b.lat - a.lat);
    const Δλ = toRad(b.lng - a.lng);
    const s = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ===== NOVO: bearing/heading + setCamera =====
  function bearingBetween(a, b) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
    const λ1 = toRad(a.lng), λ2 = toRad(b.lng);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2 - λ1);
    let θ = toDeg(Math.atan2(y, x));
    return (θ + 360) % 360;
  }
  function setCamera(heading = 0, tilt = 0) {
    if (!map) return;
    try {
      if (typeof map.setHeading === 'function') map.setHeading(heading);
      if (typeof map.setTilt === 'function') map.setTilt(tilt);
    } catch {}
  }

  /* ========= chama o backend p/ speed limit ========= */
  let lastLimitFetchAt = 0;
  let lastLimitPoint = null;

  async function refreshSpeedLimit(lat, lng) {
    try {
      const jwt = localStorage.getItem('token') || '';
      const r = await fetch(`/api/roads/speed-limit?lat=${lat}&lng=${lng}`, {
        headers: { 'x-auth-token': jwt }
      });
      if (!r.ok) throw new Error('erro roads');
      const data = await r.json();
      if (data?.speedLimitKmH != null) {
        setSpeedLimit(data.speedLimitKmH);
      } else {
        setSpeedLimit(null);
      }
    } catch (e) {
      console.warn('sem speed limit', e);
      setSpeedLimit(null);
    }
  }
});
