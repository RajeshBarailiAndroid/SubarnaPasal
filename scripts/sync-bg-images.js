#!/usr/bin/env node
/**
 * Download gold ring product images from Joyalukkas for local auth background slideshow.
 * Source: https://www.joyalukkas.in/jewellery/gold-jewellery/rings.html
 * Run: npm run sync:bg-images
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SOURCE_URL = 'https://www.joyalukkas.in/jewellery/gold-jewellery/rings.html';
const GRAPHQL_URL = 'https://www.joyalukkas.in/graphql';
const CATEGORY_PATH = 'jewellery/gold-jewellery/rings';
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'bg');
const MANIFEST = path.join(__dirname, '..', 'public', 'bg-images.json');
const MAX_IMAGES = 12;

const PRODUCTS_QUERY = `
  query GoldRingBackgroundImages($path: String!, $pageSize: Int!) {
    categoryList(filters: { url_path: { eq: $path } }) {
      products(pageSize: $pageSize) {
        items {
          name
          image { url }
        }
      }
    }
  }
`;

function fetchBuffer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SubarnaPasal/1.0)',
        ...(options.headers || {})
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(new URL(res.headers.location, url).href, options).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchGraphqlProducts() {
  const body = JSON.stringify({
    query: PRODUCTS_QUERY,
    variables: { path: CATEGORY_PATH, pageSize: MAX_IMAGES }
  });
  const buf = await fetchBuffer(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body
  });
  const payload = JSON.parse(buf.toString('utf8'));
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join('; '));
  }
  const items = payload.data?.categoryList?.[0]?.products?.items || [];
  return items
    .map((item) => ({ name: item.name, url: item.image?.url }))
    .filter((item) => item.url);
}

function cleanImageUrl(url) {
  const u = new URL(url);
  u.searchParams.set('optimize', 'high');
  u.searchParams.set('fit', 'cover');
  u.searchParams.set('width', '1200');
  u.searchParams.set('height', '1200');
  return u.href;
}

function extFromUrl(url) {
  const m = url.match(/\.(jpe?g|png|webp)(?:\?|$)/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

async function main() {
  console.log(`Fetching product list from Joyalukkas (${CATEGORY_PATH})...`);
  const products = await fetchGraphqlProducts();
  if (!products.length) {
    console.error('No products returned from GraphQL.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];

  for (let i = 0; i < products.length; i += 1) {
    const { name, url } = products[i];
    const imageUrl = cleanImageUrl(url);
    const ext = extFromUrl(imageUrl);
    const filename = `ring-${String(i + 1).padStart(2, '0')}${ext}`;
    const dest = path.join(OUT_DIR, filename);
    process.stdout.write(`Downloading ${filename} (${name})... `);
    try {
      const buf = await fetchBuffer(imageUrl);
      fs.writeFileSync(dest, buf);
      manifest.push({ src: `/images/bg/${filename}`, alt: name });
      console.log('ok');
    } catch (err) {
      console.log(`failed (${err.message})`);
    }
  }

  if (!manifest.length) {
    console.error('All downloads failed.');
    process.exit(1);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify({ source: SOURCE_URL, images: manifest }, null, 2)}\n`);
  console.log(`Saved ${manifest.length} images → ${MANIFEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
