export function checkIsMobile() {
  return typeof window !== "undefined" && window.innerWidth <= 768;
}