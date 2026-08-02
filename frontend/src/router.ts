import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import EntryPage from './pages/EntryPage.vue'
import EvidencePage from './pages/EvidencePage.vue'
import KnowledgePage from './pages/KnowledgePage.vue'
import PatientIntakePage from './pages/PatientIntakePage.vue'

export const createAppRouter = (history: RouterHistory = createWebHistory()) => createRouter({
  history,
  routes: [
    { path: '/', component: EntryPage, meta: { shell: 'landing' } },
    { path: '/clinician', component: EvidencePage, meta: { shell: 'clinician' } },
    { path: '/clinician/evidence', component: EvidencePage, meta: { shell: 'clinician' } },
    { path: '/clinician/knowledge', component: KnowledgePage, meta: { shell: 'clinician' } },
    { path: '/patient', redirect: '/patient/intake' },
    { path: '/patient/intake', component: PatientIntakePage, meta: { shell: 'patient' } },
    { path: '/evidence', redirect: '/clinician' },
    { path: '/knowledge', redirect: '/clinician/knowledge' },
    { path: '/literature', redirect: '/clinician' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
