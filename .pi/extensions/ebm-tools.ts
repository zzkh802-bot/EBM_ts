import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerEbmTools } from "../../src/extensions/ebmTools.js";

export default function ebmTools(pi: ExtensionAPI): void {
  registerEbmTools(pi);
}
