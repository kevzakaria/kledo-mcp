import type {
  KledoGetInput,
  KledoGetOutput,
  KledoQueryInput,
  KledoQueryOutput,
  KledoReportInput,
  KledoReportOutput,
} from '../tools/schemas.js'

export const KLEDO_DOCUMENT_RESOURCE = Symbol('kledo-document-resource')

export interface KledoDocumentResource {
  uri: string
  mimeType: 'application/pdf'
  blob: string
}

export type KledoGetResult = KledoGetOutput & {
  [KLEDO_DOCUMENT_RESOURCE]?: KledoDocumentResource
}

export interface KledoGateway {
  query(input: KledoQueryInput, signal?: AbortSignal): Promise<KledoQueryOutput>
  get(input: KledoGetInput, signal?: AbortSignal): Promise<KledoGetResult>
  report(input: KledoReportInput, signal?: AbortSignal): Promise<KledoReportOutput>
}
