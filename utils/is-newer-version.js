/**
 * Compares two "major.minor.patch" versions.
 * @param {string} candidate
 * @param {string} current
 * @returns {boolean} true when candidate is newer than current.
 */
const isNewerVersion = (candidate, current) => {
  const a = String(candidate).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a.at(i) || 0) - (b.at(i) || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
};

export default isNewerVersion;
