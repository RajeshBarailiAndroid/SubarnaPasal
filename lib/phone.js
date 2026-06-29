function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isNepaliPhone(digits) {
  const national = digits.replace(/^977/, '');
  return /^(97|98)\d{8}$/.test(national);
}

function isValidPhone(phone) {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  if (isNepaliPhone(digits)) return true;
  return digits.length >= 10 && digits.length <= 15;
}

module.exports = { phoneDigits, isNepaliPhone, isValidPhone };
