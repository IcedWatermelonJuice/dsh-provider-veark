/* Client half of the provider-private PDF staging Remote. */
import { z } from "zod";

const requestSchema = z.object({
	sessionId: z.string().min(1),
	name: z.string().min(1).max(255),
	mediaType: z.literal("application/pdf"),
	data: z.string().min(1)
});
const resultSchema = z.object({ token: z.uuid(), name: z.string(), bytes: z.number().int().positive() });

export const TYPERT_REMOTE = {
	package: "@icedcola/dsh-provider-veark",
	descriptors: [{
		id: "@icedcola/dsh-provider-veark#vearkPdf/stage",
		service: "vearkPdf",
		namespace: "vearkPdf",
		method: "stage",
		invocation: { kind: "direct" },
		parameters: [{
			name: "request",
			wire: "request",
			source: "json",
			codec: { mode: "strict", typeSymbol: "@icedcola/dsh-provider-veark#PdfStageRequest", schema: requestSchema }
		}],
		result: { mode: "strict", typeSymbol: "@icedcola/dsh-provider-veark#PdfStageResult", schema: resultSchema },
		sourceLocation: { file: "lib/pdf-store.js", line: 163, column: 2 }
	}]
};

export default TYPERT_REMOTE;
