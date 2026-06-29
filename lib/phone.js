function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isNepaliPhone(digits) {
  if (/^(97|98)\d{8}$/.test(digits)) return true;
  if (/^977(97|98)\d{8}$/.test(digits)) return true;
  return false;
}

function isValidPhone(phone) {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  if (isNepaliPhone(digits)) return true;
  return digits.length >= 10 && digits.length <= 15;
}

module.exports = { phoneDigits, isNepaliPhone, isValidPhone };
