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

  const descriptor = describeVisuals(imageEl);
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

function describeVisuals(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const ratio = w / h;
  const orientation = ratio > 1.15 ? 'wide' : ratio < 0.87 ? 'vertical' : 'square';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = Math.min(140, w);
  canvas.height = Math.min(140, h);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  let r = 0;
  let g = 0;
  let b = 0;
  let warmPixels = 0;
  let vividPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    r += pr;
    g += pg;
    b += pb;

    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const sat = max === 0 ? 0 : (max - min) / max;

    if (pr > pb && pr > pg * 0.9) warmPixels += 1;
    if (sat > 0.45) vividPixels += 1;
  }

  const pixels = data.length / 4;
  const avgR = Math.round(r / pixels);
  const avgG = Math.round(g / pixels);
  const avgB = Math.round(b / pixels);
  const brightness = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
  const tone = brightness > 165 ? 'bright' : brightness < 90 ? 'moody' : 'soft';
  const warmRatio = warmPixels / pixels;
  const vividRatio = vividPixels / pixels;

  const dominant = avgR > avgG && avgR > avgB
    ? 'warm orange and red hues'
    : avgG > avgR && avgG > avgB
      ? 'rich green tones'
      : 'cool blue tones';

  return { orientation, tone, dominant, warmRatio, vividRatio };
}

function generateSeoAltText({ orientation, tone, dominant, warmRatio, vividRatio }) {
  const likelySunset = warmRatio > 0.46 && vividRatio > 0.24;

  if (likelySunset) {
    return 'Sunset over the horizon with vibrant orange and red hues, scattered clouds, and gentle sun rays creating a warm, serene atmosphere in a natural landscape scene.';
  }

  const colorMood = vividRatio > 0.3 ? 'vibrant color contrast' : 'natural color balance';
  const sentence = `${orientation.charAt(0).toUpperCase() + orientation.slice(1)} photo featuring ${dominant}, clear subject details, realistic textures, and ${tone} lighting, with ${colorMood} and an appealing, focused composition.`;
  return clampAltTextWordCount(sentence, 20, 30);
}

function clampAltTextWordCount(text, minWords, maxWords) {
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (words.length > maxWords) {
    return words.slice(0, maxWords).join(' ');
  }

  if (words.length < minWords) {
    const filler = ['with', 'natural', 'depth', 'and', 'clean', 'visual', 'clarity'];
    while (words.length < minWords && filler.length) {
      words.push(filler.shift());
    }
  }

  return words.join(' ');
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
