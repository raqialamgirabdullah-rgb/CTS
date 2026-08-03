/* ===========================================================
   Image Composer — app logic
   =========================================================== */

/* ---------- element refs ---------- */
const $ = (id) => document.getElementById(id);
const logoInput = $('logoInput');
const photoInput = $('photoInput');
const logoThumb = $('logoThumb');
const photoThumb = $('photoThumb');
const bgColor = $('bgColor');
const bgHex = $('bgHex');
const swatchesEl = $('swatches');
const posGrid = $('posGrid');
const logoWidth = $('logoWidth');
const logoWidthLabel = $('logoWidthLabel');
const logoHeight = $('logoHeight');
const logoHeightLabel = $('logoHeightLabel');
const framePadding = $('framePadding');
const framePaddingLabel = $('framePaddingLabel');
const canvas = $('mainCanvas');
const placeholder = $('placeholder');
const downloadBtn = $('downloadBtn');
const openTabBtn = $('openTabBtn');
const statusEl = $('status');
const hintEl = $('hint');
const removeBgBtn = $('removeBgBtn');
const bgRemoveStatus = $('bgRemoveStatus');
const useProcessedRow = $('useProcessedRow');
const useProcessedToggle = $('useProcessedToggle');
const segBtns = document.querySelectorAll('.seg-btn');
const eraseControls = $('eraseControls');
const moveControls = $('moveControls');
const brushSize = $('brushSize');
const brushSizeLabel = $('brushSizeLabel');
const eraseTransparent = $('eraseTransparent');
const eraseColor = $('eraseColor');
const cancelMoveBtn = $('cancelMoveBtn');
const resetEditsBtn = $('resetEditsBtn');
const ctx = canvas.getContext('2d');

/* ---------- shared state ---------- */
let logoImg = null;
let photoImg = null;        // original uploaded photo (with its own background)
let processedImg = null;    // same photo after AI background removal (transparent PNG)
let currentPos = 'top-left';
let removeBackgroundFn = null; // lazy-loaded AI function

// editCanvas holds the *editable working copy* of the photo — every erase/move
// edit is drawn directly onto it, so edits persist across background/logo changes.
const editCanvas = document.createElement('canvas');
const editCtx = editCanvas.getContext('2d');

// editor tool state
let tool = 'none';          // 'none' | 'erase' | 'move'
let isErasing = false;
let moveState = 'idle';     // 'idle' | 'selecting' | 'placing'
let dragStart = null;
let selRect = null;         // {x,y,w,h} in editCanvas pixel space
let clip = null;            // ImageData currently lifted out, awaiting placement

/* ---------- small shared helpers (used in more than one place) ---------- */

function loadImageFile(file, callback) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => callback(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function wireUploader(inputEl, thumbEl, onLoaded) {
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadImageFile(file, (img) => {
      thumbEl.src = img.src;
      thumbEl.classList.add('show');
      onLoaded(img);
    });
  });
}

function wireRange(rangeEl, labelEl, suffix) {
  rangeEl.addEventListener('input', () => {
    labelEl.textContent = rangeEl.value + suffix;
    render();
  });
}

function alignFraction(keyword, startWord, centerWord) {
  if (keyword === startWord) return 0;
  if (keyword === centerWord) return 0.5;
  return 1;
}

function canvasToPngBlob() {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function showHint(msg) {
  hintEl.textContent = msg || 'This viewer may block direct downloads. Click "Open in New Tab", then right-click the image and choose "Save image as". For best results, open this page directly in a browser.';
}

async function ensureBgRemovalLib() {
  if (removeBackgroundFn) return removeBackgroundFn;
  bgRemoveStatus.classList.remove('hidden');
  bgRemoveStatus.textContent = 'Loading AI model (first run may take a moment)...';
  const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
  removeBackgroundFn = mod.removeBackground;
  return removeBackgroundFn;
}

// (re)builds the editable working copy from whichever source image is active
function initEditCanvas() {
  const src = (processedImg && useProcessedToggle.checked) ? processedImg : photoImg;
  if (!src) return;
  editCanvas.width = src.naturalWidth;
  editCanvas.height = src.naturalHeight;
  editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
  editCtx.drawImage(src, 0, 0);
}

// current layout numbers, shared by render() and the pointer handlers
function getLayout() {
  const photoW = editCanvas.width;
  const photoH = editCanvas.height;
  const padPct = framePadding.value / 100;
  const padX = photoW * padPct;
  const padY = photoH * padPct;
  return { photoW, photoH, padX, padY, W: photoW + padX * 2, H: photoH + padY * 2 };
}

// converts a pointer event to a position inside the photo (editCanvas) pixel space
function getPhotoLocalPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const { padX, padY, photoW, photoH } = getLayout();
  let x = (e.clientX - rect.left) * scaleX - padX;
  let y = (e.clientY - rect.top) * scaleY - padY;
  x = Math.max(0, Math.min(photoW, x));
  y = Math.max(0, Math.min(photoH, y));
  return { x, y };
}

/* ---------- background color swatches ---------- */
const swatchColors = ['#131a36','#f6f4ef','#1c1b19','#2f6f5e','#c0392b','#2d3d8c','#b8872f','#ffffff'];
swatchColors.forEach((c) => {
  const s = document.createElement('div');
  s.className = 'swatch';
  s.style.background = c;
  s.addEventListener('click', () => {
    bgColor.value = c;
    bgHex.value = c;
    render();
  });
  swatchesEl.appendChild(s);
});

/* ---------- uploaders ---------- */
wireUploader(logoInput, logoThumb, (img) => {
  logoImg = img;
  render();
});

// default logo lives in its own file next to this page — keeps the HTML small
// and works once both files sit in the same hosting location. Point this at
// a full URL (e.g. a jsDelivr/GitHub link) if the logo is hosted elsewhere.
(function loadDefaultLogo() {
  const img = new Image();
  img.onload = () => {
    logoImg = img;
    logoThumb.src = img.src;
    logoThumb.classList.add('show');
    render();
  };
  img.onerror = () => { /* no default-logo.webp found — fine, just upload one */ };
  img.src = 'default-logo.webp';
})();

wireUploader(photoInput, photoThumb, (img) => {
  photoImg = img;
  processedImg = null;
  useProcessedRow.classList.add('hidden');
  bgRemoveStatus.classList.add('hidden');
  removeBgBtn.disabled = false;
  cancelPendingMove();
  initEditCanvas();
  render();
});

/* ---------- AI background removal ---------- */
removeBgBtn.addEventListener('click', async () => {
  if (!photoImg) return;
  removeBgBtn.disabled = true;
  bgRemoveStatus.classList.remove('hidden');
  try {
    const fn = await ensureBgRemovalLib();
    bgRemoveStatus.textContent = 'Detecting and removing background...';
    const resultBlob = await fn(photoImg.src, {
      model: 'medium',
      output: { format: 'image/png' },
      progress: (key, current, total) => {
        if (total) bgRemoveStatus.textContent = `Processing (${key}): ${Math.round((current / total) * 100)}%`;
      }
    });
    const img = new Image();
    img.onload = () => {
      processedImg = img;
      useProcessedRow.classList.remove('hidden');
      useProcessedToggle.checked = true;
      bgRemoveStatus.textContent = 'Background removed — now try changing the background color.';
      removeBgBtn.disabled = false;
      cancelPendingMove();
      initEditCanvas();
      render();
    };
    img.src = URL.createObjectURL(resultBlob);
  } catch (err) {
    bgRemoveStatus.textContent = 'Sorry, background removal failed. Please try again.';
    removeBgBtn.disabled = false;
    console.error(err);
  }
});
useProcessedToggle.addEventListener('change', () => {
  cancelPendingMove();
  initEditCanvas();
  render();
});

/* ---------- background color inputs ---------- */
bgColor.addEventListener('input', () => {
  bgHex.value = bgColor.value;
  render();
});
bgHex.addEventListener('change', () => {
  let v = bgHex.value.trim();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    bgColor.value = v;
    render();
  }
});

/* ---------- logo position grid ---------- */
posGrid.querySelectorAll('.pos-cell').forEach((cell) => {
  cell.addEventListener('click', () => {
    posGrid.querySelectorAll('.pos-cell').forEach((c) => c.classList.remove('active'));
    cell.classList.add('active');
    currentPos = cell.dataset.pos;
    render();
  });
});

/* ---------- sliders ---------- */
wireRange(logoWidth, logoWidthLabel, '%');
wireRange(logoHeight, logoHeightLabel, '%');
wireRange(framePadding, framePaddingLabel, '%');
wireRange(brushSize, brushSizeLabel, '%');

/* ---------- photo editor: tool switching (Off / Erase / Move segmented control) ---------- */
function setTool(t) {
  if (tool === 'move' && t !== 'move') cancelPendingMove();
  tool = t;
  segBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  eraseControls.classList.toggle('hidden', t !== 'erase');
  moveControls.classList.toggle('hidden', t !== 'move');
  canvas.classList.toggle('tool-active', t !== 'none');
}
segBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function cancelPendingMove() {
  if (moveState === 'placing' && clip && selRect) {
    editCtx.putImageData(clip, selRect.x, selRect.y);
  }
  moveState = 'idle';
  clip = null;
  selRect = null;
  cancelMoveBtn.classList.add('hidden');
  render();
}
cancelMoveBtn.addEventListener('click', cancelPendingMove);

resetEditsBtn.addEventListener('click', () => {
  cancelPendingMove();
  initEditCanvas();
  render();
});

/* ---------- photo editor: erase brush ---------- */
function eraseAt(pos) {
  const r = editCanvas.width * (brushSize.value / 100);
  editCtx.save();
  if (eraseTransparent.checked) {
    editCtx.globalCompositeOperation = 'destination-out';
    editCtx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    editCtx.fillStyle = eraseColor.value;
  }
  editCtx.beginPath();
  editCtx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  editCtx.fill();
  editCtx.restore();
  render();
}

/* ---------- photo editor: select & move ---------- */
canvas.addEventListener('pointerdown', (e) => {
  if (!photoImg || tool === 'none') return;
  const pos = getPhotoLocalPos(e);
  if (tool === 'erase') {
    isErasing = true;
    eraseAt(pos);
  } else if (tool === 'move') {
    if (moveState === 'idle') {
      dragStart = pos;
      selRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
      moveState = 'selecting';
    } else if (moveState === 'placing') {
      const px = pos.x - clip.width / 2;
      const py = pos.y - clip.height / 2;
      editCtx.putImageData(clip, px, py);
      moveState = 'idle';
      clip = null;
      selRect = null;
      cancelMoveBtn.classList.add('hidden');
      render();
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!photoImg) return;
  if (tool === 'erase' && isErasing) {
    eraseAt(getPhotoLocalPos(e));
  } else if (tool === 'move' && moveState === 'selecting') {
    const pos = getPhotoLocalPos(e);
    selRect.w = pos.x - dragStart.x;
    selRect.h = pos.y - dragStart.y;
    render();
  }
});

window.addEventListener('pointerup', () => {
  if (tool === 'erase') { isErasing = false; return; }
  if (tool === 'move' && moveState === 'selecting') {
    const x = Math.min(selRect.x, selRect.x + selRect.w);
    const y = Math.min(selRect.y, selRect.y + selRect.h);
    const w = Math.abs(selRect.w);
    const h = Math.abs(selRect.h);
    if (w < 6 || h < 6) {
      moveState = 'idle';
      selRect = null;
      render();
      return;
    }
    selRect = { x, y, w, h };
    clip = editCtx.getImageData(x, y, w, h);
    editCtx.clearRect(x, y, w, h);
    moveState = 'placing';
    cancelMoveBtn.classList.remove('hidden');
    render();
  }
});

/* ---------- render ---------- */
function render() {
  if (!photoImg) {
    placeholder.style.display = 'flex';
    canvas.style.display = 'none';
    downloadBtn.disabled = true;
    openTabBtn.disabled = true;
    statusEl.textContent = 'Waiting: upload a photo';
    return;
  }

  placeholder.style.display = 'none';
  canvas.style.display = 'block';
  downloadBtn.disabled = false;
  openTabBtn.disabled = false;

  const { photoW, photoH, padX, padY, W, H } = getLayout();
  canvas.width = W;
  canvas.height = H;

  // 1. background fill — shows through any transparent/erased areas of the photo
  ctx.fillStyle = bgColor.value;
  ctx.fillRect(0, 0, W, H);

  // 2. the edited working copy of the photo (erase/move edits already baked in)
  ctx.drawImage(editCanvas, padX, padY, photoW, photoH);

  // 3. the logo, sized independently on each axis, positioned via alignFraction
  if (logoImg) {
    const margin = W * 0.03;
    const lw = W * (logoWidth.value / 100);
    const lh = H * (logoHeight.value / 100);
    const [vPos, hPos] = currentPos.split('-');
    const fx = alignFraction(hPos, 'left', 'center');
    const fy = alignFraction(vPos, 'top', 'middle');
    const x = margin + fx * (W - lw - margin * 2);
    const y = margin + fy * (H - lh - margin * 2);
    ctx.drawImage(logoImg, x, y, lw, lh);
  }

  // 4. selection outline overlay while actively dragging a move-selection
  if (tool === 'move' && moveState === 'selecting' && selRect) {
    ctx.save();
    ctx.strokeStyle = '#b8872f';
    ctx.lineWidth = Math.max(2, W * 0.003);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(
      padX + Math.min(selRect.x, selRect.x + selRect.w),
      padY + Math.min(selRect.y, selRect.y + selRect.h),
      Math.abs(selRect.w),
      Math.abs(selRect.h)
    );
    ctx.restore();
  }

  statusEl.textContent = `Canvas size: ${Math.round(W)} × ${Math.round(H)}px — ready`;
}

/* ---------- export ---------- */
downloadBtn.addEventListener('click', async () => {
  const blob = await canvasToPngBlob();
  if (!blob) { showHint(); return; }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'composed-image.png';
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showHint('If the download doesn\'t start, use "Open in New Tab" below, then right-click the image and choose "Save image as".');
});

openTabBtn.addEventListener('click', async () => {
  const blob = await canvasToPngBlob();
  if (!blob) { showHint(); return; }
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) showHint();
});

/* ---------- panel / tab dock ---------- */
const tabs = document.querySelectorAll('.tab');
const sheet = $('sheet');
let activePanel = null;

function openPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
  sheet.classList.add('open');
  activePanel = name;
  if (name !== 'editor') setTool('none');
}

function closePanel() {
  sheet.classList.remove('open');
  tabs.forEach((t) => t.classList.remove('active'));
  activePanel = null;
  setTool('none');
}

tabs.forEach((t) => {
  t.addEventListener('click', () => {
    if (activePanel === t.dataset.panel) closePanel();
    else openPanel(t.dataset.panel);
  });
});
document.querySelectorAll('.panel-close').forEach((b) => b.addEventListener('click', closePanel));

/* open the Photo panel by default so first-time users see where to start */
openPanel('photo');
