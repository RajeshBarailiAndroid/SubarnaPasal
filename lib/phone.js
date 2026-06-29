const PHONE_REGIONS = ['NP', 'US', 'CA'];

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isNepaliPhone(digits) {
  const national = String(digits).replace(/^977/, '');
  return /^(97|98)\d{8}$/.test(national);
}

function isNanpPhone(digits) {
  const d = String(digits).replace(/^1/, '');
  return d.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(d);
}

function isUsPhone(digits) {
  return isNanpPhone(digits);
}

function isCanadianPhone(digits) {
  return isNanpPhone(digits);
}

function normalizePhoneRegion(region) {
  const code = String(region || 'NP').toUpperCase();
  return PHONE_REGIONS.includes(code) ? code : 'NP';
}

function isValidPhoneForRegion(phone, region) {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  const r = normalizePhoneRegion(region);
  if (r === 'NP') return isNepaliPhone(digits);
  if (r === 'US') return isUsPhone(digits);
  if (r === 'CA') return isCanadianPhone(digits);
  return false;
}

function isValidPhone(phone, region) {
  if (region) return isValidPhoneForRegion(phone, region);
  const digits = phoneDigits(phone);
  if (!digits) return false;
  return isNepaliPhone(digits) || isNanpPhone(digits);
}

function phoneErrorMessage(region) {
  const r = normalizePhoneRegion(region);
  if (r === 'NP') return 'Enter a valid Nepal mobile number (97/98XXXXXXXX or +977…).';
  if (r === 'US') return 'Enter a valid US phone number (10 digits).';
  if (r === 'CA') return 'Enter a valid Canadian phone number (10 digits).';
  return 'Enter a valid phone number.';
}

module.exports = {
  PHONE_REGIONS,
  phoneDigits,
  isNepaliPhone,
  isUsPhone,
  isCanadianPhone,
  isValidPhoneForRegion,
  isValidPhone,
  normalizePhoneRegion,
  phoneErrorMessage
};
