// Tín hiệu xác minh máy cho guard.py (vân tay fp/hw, múi giờ, IP qua WebRTC, vị trí) — mọi tool công khai dùng chung.
// Giữ nguyên cách tính: đổi một chi tiết là đổi vân tay của mọi máy, quota (khoá fp:/hw:) bị tính lại từ đầu.
window.OtterSignals = (() => {
  'use strict';

  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function canvasPrint() {
    try {
      const c = document.createElement('canvas');
      c.width = 280; c.height = 60;
      const x = c.getContext('2d');
      x.textBaseline = 'top';
      x.font = '16px Arial';
      x.fillStyle = '#f60'; x.fillRect(100, 1, 62, 20);
      x.fillStyle = '#069'; x.fillText('Otter ptn1411 ẩ ơ ữ 1.23 ✓', 2, 15);
      x.fillStyle = 'rgba(102,204,0,0.7)'; x.fillText('Otter ptn1411 ẩ ơ ữ 1.23 ✓', 4, 17);
      x.beginPath(); x.arc(50, 50, 20, 0, Math.PI * 2); x.stroke();
      return c.toDataURL();
    } catch (e) { return ''; }
  }

  function webglPrint() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return [
        gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
        gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
      ].join('|');
    } catch (e) { return ''; }
  }

  // IP công khai mà trình duyệt thấy qua STUN; khác IP máy chủ thấy -> đang đi qua VPN/proxy.
  function webrtcIps(timeout = 2500) {
    return new Promise((resolve) => {
      const ips = new Set();
      let pc, finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try { pc && pc.close(); } catch (e) { /* bỏ qua */ }
        resolve([...ips]);
      };
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] });
      } catch (e) { return resolve([]); }
      pc.createDataChannel('x');
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return finish();
        const c = ev.candidate.candidate || '';
        if (!/ typ srflx/.test(c)) return;
        const parts = c.split(' ');
        if (parts[4]) ips.add(parts[4]);
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(finish);
      setTimeout(finish, timeout);
    });
  }

  let baseSignals = null;
  async function collectBase() {
    if (baseSignals) return baseSignals;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    // hw: chỉ thông số giống nhau giữa mọi trình duyệt trên cùng máy, để đổi Chrome -> Firefox/Safari không ra máy mới.
    // deviceMemory (chỉ Chromium có) và chuỗi WebGL (Firefox rút gọn, Chrome trả ANGLE) khác theo trình duyệt -> chỉ vào fp.
    const hwParts = [
      screen.width, screen.height, screen.colorDepth,
      navigator.hardwareConcurrency || 0, navigator.platform || '', tz,
    ];
    const ua = navigator.userAgent.replace(/[\d._]+/g, '');
    const fpParts = hwParts.concat([
      navigator.deviceMemory || 0, webglPrint(), canvasPrint(), (navigator.languages || []).join(','), ua, navigator.maxTouchPoints || 0,
    ]);
    const [hw, fp, webrtc] = await Promise.all([sha256(hwParts.join('§')), sha256(fpParts.join('§')), webrtcIps()]);
    baseSignals = { hw, fp, tz, webrtc, webdriver: !!navigator.webdriver };
    return baseSignals;
  }

  let geoCache = null;
  function getGeo() {
    if (geoCache && Date.now() - geoCache.at < 10 * 60 * 1000) return Promise.resolve(geoCache.geo);
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const geo = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
          geoCache = { geo, at: Date.now() };
          resolve(geo);
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
      );
    });
  }

  async function signals(withGeo) {
    const s = Object.assign({}, await collectBase(), { ts: Date.now(), tzOffset: -new Date().getTimezoneOffset() });
    if (withGeo) s.geo = await getGeo();
    return JSON.stringify(s);
  }

  return { signals };
})();
window.RetecSignals = window.OtterSignals;
