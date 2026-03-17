const imageInput = document.getElementById('imageInput');
const processBtn = document.getElementById('processBtn');
const results = document.getElementById('results');
const qualityInput = document.getElementById('qualityInput');
const qualityOutput = document.getElementById('qualityOutput');
const reductionInput = document.getElementById('reductionInput');
const reductionOutput = document.getElementById('reductionOutput');
const keepOriginalInput = document.getElementById('keepOriginal');
const downloadAllBtn = document.getElementById('downloadAll');
const clearAllBtn = document.getElementById('clearAll');
const footerActions = document.getElementById('footerActions');
const itemTemplate = document.getElementById('itemTemplate');

const appState = {
  files: [],
  processed: []
};

qualityInput.addEventListener('input', () => {
  qualityOutput.value = `${Math.round(Number(qualityInput.value) * 100)}%`;
});
reductionInput.addEventListener('input', () => {
  reductionOutput.value = `${Math.round(Number(reductionInput.value) * 100)}%`;
});

imageInput.addEventListener('change', () => {
  appState.files = [...imageInput.files].filter((file) => file.type.startsWith('image/'));
  processBtn.disabled = appState.files.length === 0;
});

processBtn.addEventListener('click', async () => {
  if (!appState.files.length) return;
  processBtn.disabled = true;
  processBtn.textContent = 'Processing...';
  results.innerHTML = '';
  appState.processed = [];

  const quality = Number(qualityInput.value);
  const reductionRatio = Number(reductionInput.value);

  for (const file of appState.files) {
    const item = await processImage(file, quality, reductionRatio);
    appState.processed.push(item);
    renderImageCard(item);
  }

  processBtn.textContent = 'Optimize + Convert + Generate Alt Text';
  processBtn.disabled = false;
  footerActions.classList.toggle('hidden', appState.processed.length < 2);
});

downloadAllBtn.addEventListener('click', async () => {
  if (!appState.processed.length) return;

  await copyAltText(appState.processed[0].altText);

  for (const item of appState.processed) {
    downloadFile(item.optimizedBlob, item.webpName);
    if (keepOriginalInput.checked) {
      downloadFile(item.originalFile, item.originalFile.name);
    }
    await wait(120);
  }

  clearWorkflow();
});

clearAllBtn.addEventListener('click', clearWorkflow);

async function processImage(file, initialQuality, reductionRatio) {
  const srcUrl = URL.createObjectURL(file);
  const imageEl = await loadImage(srcUrl);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = imageEl.naturalWidth;
  canvas.height = imageEl.naturalHeight;
  ctx.drawImage(imageEl, 0, 0);

  const targetSize = Math.max(5000, file.size * (1 - reductionRatio));
  let quality = initialQuality;
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > targetSize && quality > 0.58) {
    quality -= 0.04;
    blob = await canvasToBlob(canvas, quality);
  }

  const optimizedUrl = URL.createObjectURL(blob);
  const webpName = `${file.name.replace(/\.[^.]+$/, '')}.webp`;

  const descriptor = describeVisuals(imageEl, file.name);
  const altText = generateSeoAltText(descriptor);

  URL.revokeObjectURL(srcUrl);

  return {
    originalFile: file,
    webpName,
    originalSize: file.size,
    optimizedSize: blob.size,
    optimizedBlob: blob,
    srcUrl: URL.createObjectURL(file),
    optimizedUrl,
    altText
  };
}

function renderImageCard(item) {
  const fragment = itemTemplate.content.cloneNode(true);

  fragment.querySelector('.original-preview').src = item.srcUrl;
  fragment.querySelector('.optimized-preview').src = item.optimizedUrl;
  fragment.querySelector('.original-meta').textContent = `Size: ${formatBytes(item.originalSize)}`;

  const saved = ((1 - item.optimizedSize / item.originalSize) * 100).toFixed(1);
  fragment.querySelector('.optimized-meta').textContent = `Size: ${formatBytes(item.optimizedSize)} • Saved ${saved}%`;

  const altInput = fragment.querySelector('.alt-input');
  altInput.value = item.altText;

  const msgEl = fragment.querySelector('.copied-msg');
  const downloadOneBtn = fragment.querySelector('.download-one');

  downloadOneBtn.addEventListener('click', async () => {
    item.altText = altInput.value.trim();
    await copyAltText(item.altText);

    downloadFile(item.optimizedBlob, item.webpName);
    if (keepOriginalInput.checked) {
      downloadFile(item.originalFile, item.originalFile.name);
    }

    msgEl.textContent = 'Alt text copied and download started.';
    setTimeout(() => (msgEl.textContent = ''), 2000);
    clearWorkflow();
  });

  altInput.addEventListener('input', () => {
    item.altText = altInput.value;
  });

  results.appendChild(fragment);
}

function describeVisuals(img, filename) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const ratio = w / h;
  const orientation = ratio > 1.15 ? 'landscape' : ratio < 0.87 ? 'portrait' : 'square';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = Math.min(120, w);
  canvas.height = Math.min(120, h);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  const pixels = data.length / 4;
  r = Math.round(r / pixels);
  g = Math.round(g / pixels);
  b = Math.round(b / pixels);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const tone = brightness > 170 ? 'bright' : brightness < 85 ? 'dark' : 'balanced';
  const dominant = r > g && r > b ? 'red tones' : g > r && g > b ? 'green tones' : 'blue tones';
  const cleanedName = filename.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, '');

  return { orientation, tone, dominant, cleanedName };
}

function generateSeoAltText({ orientation, tone, dominant, cleanedName }) {
  const keywords = cleanedName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');

  const base = `Detailed ${orientation} photo featuring ${keywords || 'the main subject'} with ${dominant}, ${tone} lighting, crisp textures, and natural depth, clearly highlighting the scene for search relevance and accessibility context.`;

  const words = base.trim().split(/\s+/);
  if (words.length > 30) return words.slice(0, 30).join(' ');
  if (words.length < 20) return `${base} Professional quality imagery.`;
  return base;
}

function clearWorkflow() {
  for (const item of appState.processed) {
    URL.revokeObjectURL(item.srcUrl);
    URL.revokeObjectURL(item.optimizedUrl);
  }

  appState.files = [];
  appState.processed = [];
  imageInput.value = '';
  results.innerHTML = '';
  processBtn.disabled = true;
  footerActions.classList.add('hidden');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const sizes = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    bytes /= 1024;
    i += 1;
  } while (bytes >= 1024 && i < sizes.length - 1);
  return `${bytes.toFixed(2)} ${sizes[i]}`;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not convert canvas to blob'));
      resolve(blob);
    }, 'image/webp', quality);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function copyAltText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    document.body.removeChild(helper);
  }
}

function downloadFile(blobOrFile, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blobOrFile);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1200);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
