/* Provider-private Remote contract used to stage PDF bytes on the Host. */
import { z } from "zod";

const requestSchema = z.object({
	sessionId: z.string().min(1),
	name: z.string().min(1).max(255),
	mediaType: z.literal("application/pdf"),
	data: z.string().min(1)
});
const resultSchema = z.object({
	token: z.uuid(),
	name: z.string(),
	bytes: z.number().int().positive()
});

const descriptor = {
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
};

export const TYPERT = {
	package: "@icedcola/dsh-provider-veark",
	face: "host",
	schemas: [],
	invocations: [descriptor],
	model: {
		services: [{
			description: "Provider-private PDF staging service.",
			summary: "Provider-private PDF staging service.",
			tags: [],
			jsDoc: "/** Provider-private PDF staging service. */",
			key: "vearkPdf",
			exportName: "VeArkPdfService",
			members: [{ kind: "method", name: "stage", signature: "@Remote('stage') stage(request)", summary: "Stage one PDF for a provider-bound prompt.", jsDoc: "/** Stage one PDF for a provider-bound prompt. */" }],
			types: []
		}],
		events: [],
		objects: []
	}
};
