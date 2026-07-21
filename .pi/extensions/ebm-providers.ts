import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerEbmProviders } from "../../src/providers/providerCatalog.js";

export default function ebmProviders(pi: ExtensionAPI): void {
  registerEbmProviders(pi);
}
