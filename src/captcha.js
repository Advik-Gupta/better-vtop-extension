const VXCaptcha = (() => {
  const WIDTH = 200;
  const HEIGHT = 40;
  const TILE_W = 25;
  const TILE_H = 26;
  const LEFT = 25;
  const STEP = 25;
  const SLOTS = 6;
  const PAD = 3;
  const SIZE = TILE_W * TILE_H;
  const BYTES = Math.ceil(SIZE / 8);
  const LEARNED_KEY = "captchaLearned";
  const PENDING_KEY = "captchaPending";
  const LEARNED_LIMIT = 1200;
  const PENDING_MAX_AGE = 3 * 60 * 1000;
  const CHARSET = /^[A-Z0-9]{6}$/;

  const SHIFTS = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) SHIFTS.push([dy, dx]);

  let enabled = true;
  let references = null;
  let current = null;
  let pendingChecked = false;

  function inkMask(pixels) {
    const mask = new Uint8Array(WIDTH * HEIGHT);
    for (let i = 0; i < mask.length; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      mask[i] = r - Math.max(g, b) > 50 ? 1 : 0;
    }
    return mask;
  }

  function tileAt(mask, slot) {
    const x0 = LEFT + slot * STEP;
    const tile = new Uint8Array(SIZE);
    let top = -1;
    for (let y = 0; y < HEIGHT && top < 0; y++) {
      let ink = 0;
      for (let x = 0; x < TILE_W; x++) ink += mask[y * WIDTH + x0 + x];
      if (ink >= 2) top = y;
    }
    if (top < 0) return tile;
    for (let y = 0; y < TILE_H && top + y < HEIGHT; y++) {
      for (let x = 0; x < TILE_W; x++) tile[y * TILE_W + x] = mask[(top + y) * WIDTH + x0 + x];
    }
    return tile;
  }

  function blur(tile) {
    const out = new Float32Array(SIZE);
    const at = (y, x) => (y < 0 || y >= TILE_H || x < 0 || x >= TILE_W ? 0 : tile[y * TILE_W + x]);
    for (let y = 0; y < TILE_H; y++) {
      for (let x = 0; x < TILE_W; x++) {
        out[y * TILE_W + x] =
          (at(y - 1, x) + at(y + 1, x) + at(y, x - 1) + at(y, x + 1) + 2 * at(y, x)) / 6;
      }
    }
    return out;
  }

  function unit(vector) {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
    const norm = Math.sqrt(sum) + 1e-6;
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
    return vector;
  }

  function shifted(blurred, dy, dx) {
    const out = new Float32Array(SIZE);
    for (let y = 0; y < TILE_H; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= TILE_H) continue;
      for (let x = 0; x < TILE_W; x++) {
        const sx = x + dx;
        if (sx >= 0 && sx < TILE_W) out[y * TILE_W + x] = blurred[sy * TILE_W + sx];
      }
    }
    return unit(out);
  }

  function pack(tiles) {
    const bytes = new Uint8Array(tiles.length * BYTES);
    tiles.forEach((tile, t) => {
      for (let i = 0; i < SIZE; i++) {
        if (tile[i]) bytes[t * BYTES + (i >> 3)] |= 128 >> (i & 7);
      }
    });
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function unpack(base64) {
    const binary = atob(base64);
    const tiles = [];
    for (let t = 0; t + BYTES <= binary.length; t += BYTES) {
      const tile = new Uint8Array(SIZE);
      for (let i = 0; i < SIZE; i++) {
        tile[i] = (binary.charCodeAt(t + (i >> 3)) >> (7 - (i & 7))) & 1;
      }
      tiles.push(tile);
    }
    return tiles;
  }

  function toReferences(labels, base64) {
    return unpack(base64).map((tile, i) => ({
      char: labels[i],
      source: i,
      vector: unit(blur(tile)),
    }));
  }

  function read(pixels, refs) {
    const mask = inkMask(pixels);
    const tiles = [];
    let text = "";
    for (let slot = 0; slot < SLOTS; slot++) {
      const tile = tileAt(mask, slot);
      tiles.push(tile);
      const blurred = blur(tile);
      const candidates = SHIFTS.map(([dy, dx]) => shifted(blurred, dy, dx));
      let best = -1;
      let char = "";
      for (const ref of refs) {
        for (const candidate of candidates) {
          let score = 0;
          for (let i = 0; i < SIZE; i++) score += candidate[i] * ref.vector[i];
          if (score > best) {
            best = score;
            char = ref.char;
          }
        }
      }
      text += char;
    }
    return { text, tiles };
  }

  async function loadReferences() {
    if (references) return references;
    const learned = (await chrome.storage.local.get(LEARNED_KEY))[LEARNED_KEY];
    references = [
      ...toReferences(VXCaptchaData.labels, VXCaptchaData.tiles),
      ...(learned ? toReferences(learned.labels, learned.tiles) : []),
    ];
    return references;
  }

  async function pixelsOf(img) {
    if (!img.complete || !img.naturalWidth) await img.decode().catch(() => {});
    if (img.naturalWidth !== WIDTH || img.naturalHeight !== HEIGHT) return null;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(img, 0, 0);
    return context.getImageData(0, 0, WIDTH, HEIGHT).data;
  }

  const captchaImage = () =>
    document.querySelector("#captchaBlock img") ??
    document.querySelector("#vtopLoginForm img[src^='data:image']");

  const captchaInput = () =>
    document.querySelector("#captchaStr") ?? document.querySelector("input[name='captchaStr']");

  function remember() {
    const input = captchaInput();
    if (!current || !input) return;
    chrome.storage.local.set({
      [PENDING_KEY]: {
        text: input.value.trim().toUpperCase(),
        tiles: pack(current.tiles),
        at: Date.now(),
      },
    });
  }

  async function fill() {
    const img = captchaImage();
    const input = captchaInput();
    if (!enabled || !img || !input || current?.src === img.src) return;
    const src = img.src;
    current = { src, tiles: [] };
    const pixels = await pixelsOf(img);
    if (!pixels || captchaImage()?.src !== src) return;
    const result = read(pixels, await loadReferences());
    current = { src, tiles: result.tiles };
    if (!input.value) {
      input.value = result.text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    remember();
  }

  async function learn() {
    const stored = await chrome.storage.local.get([PENDING_KEY, LEARNED_KEY]);
    const pending = stored[PENDING_KEY];
    if (!pending) return;
    await chrome.storage.local.remove(PENDING_KEY);
    if (Date.now() - pending.at > PENDING_MAX_AGE || !CHARSET.test(pending.text)) return;
    const learned = stored[LEARNED_KEY] ?? { labels: "", tiles: "" };
    const labels = (learned.labels + pending.text).slice(-LEARNED_LIMIT);
    const tiles = [...unpack(learned.tiles), ...unpack(pending.tiles)].slice(-LEARNED_LIMIT);
    await chrome.storage.local.set({ [LEARNED_KEY]: { labels, tiles: pack(tiles) } });
    references = null;
  }

  function scan() {
    if (!document.querySelector("#vtop-header #vtopHeaderBarControl")) return fill();
    if (pendingChecked) return;
    pendingChecked = true;
    learn();
  }

  if (typeof document !== "undefined" && typeof VXDom !== "undefined") {
    document.addEventListener("input", (e) => {
      if (e.target === captchaInput()) remember();
    });
    VXDom.onPageChange(scan);
    VXDom.onSetting("captcha", (on) => {
      enabled = on;
      scan();
    });
  }

  return { read, toReferences, pack, unpack };
})();
