import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import EvidencePage from './pages/EvidencePage.vue'
import KnowledgePage from './pages/KnowledgePage.vue'
import EntryPage from './pages/EntryPage.vue'
import PatientIntakePage from './pages/PatientIntakePage.vue'
import './styles/index.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: EntryPage, meta: { shell: 'landing' } },
    { path: '/clinician', redirect: '/clinician/evidence' },
    { path: '/clinician/evidence', component: EvidencePage, meta: { shell: 'clinician' } },
    { path: '/clinician/knowledge', component: KnowledgePage, meta: { shell: 'clinician' } },
    { path: '/patient', redirect: '/patient/intake' },
    { path: '/patient/intake', component: PatientIntakePage, meta: { shell: 'patient' } },
    { path: '/evidence', redirect: '/clinician/evidence' },
    { path: '/knowledge', redirect: '/clinician/knowledge' },
    { path: '/literature', redirect: '/clinician/evidence' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

createApp(App).use(createPinia()).use(router).mount('#app')
