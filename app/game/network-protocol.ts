export function resolveNetworkProtocol(search: string): 2 | 3 {
  return new URLSearchParams(search).get("protocol") === "2" ? 2 : 3;
}
