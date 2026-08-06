import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import EntryPage from './pages/EntryPage.vue'
import EvidencePage from './pages/EvidencePage.vue'
import KnowledgePage from './pages/KnowledgePage.vue'
import { PATIENT_INTAKE_ENABLED } from './config/features'

const patientRoutes = PATIENT_INTAKE_ENABLED
  ? [
      { path: '/patient', redirect: '/patient/intake' },
      { path: '/patient/intake', component: () => import('./pages/PatientIntakePage.vue'), meta: { shell: 'patient' } },
    ]
  : [
      { path: '/patient', redirect: '/' },
      { path: '/patient/:pathMatch(.*)*', redirect: '/' },
    ]

export const createAppRouter = (history: RouterHistory = createWebHistory()) => createRouter({
  history,
  routes: [
    { path: '/', component: EntryPage, meta: { shell: 'landing' } },
    { path: '/clinician', component: EvidencePage, meta: { shell: 'clinician' } },
    { path: '/clinician/evidence', component: EvidencePage, meta: { shell: 'clinician' } },
    { path: '/clinician/knowledge', component: KnowledgePage, meta: { shell: 'clinician' } },
    ...patientRoutes,
    { path: '/evidence', redirect: '/clinician' },
    { path: '/knowledge', redirect: '/clinician/knowledge' },
    { path: '/literature', redirect: '/clinician' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
