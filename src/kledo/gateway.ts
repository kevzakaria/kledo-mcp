import type {
  KledoGetInput,
  KledoGetOutput,
  KledoQueryInput,
  KledoQueryOutput,
  KledoReportInput,
  KledoReportOutput,
} from '../tools/schemas.js'

export interface KledoGateway {
  query(input: KledoQueryInput, signal?: AbortSignal): Promise<KledoQueryOutput>
  get(input: KledoGetInput, signal?: AbortSignal): Promise<KledoGetOutput>
  report(input: KledoReportInput, signal?: AbortSignal): Promise<KledoReportOutput>
}
