// The patient health-Q&A surface is enabled by default. Set to 0 only when a
// deployment intentionally needs to hide it.
export const PATIENT_INTAKE_ENABLED = import.meta.env.VITE_ENABLE_PATIENT_INTAKE !== '0'
