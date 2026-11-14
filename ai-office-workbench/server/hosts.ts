/** 本项目只在本机运行，这些 Host 之外的请求一律拒绝（防 DNS rebinding）。 */
export const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export function isLocalOrigin(origin: string) {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}
