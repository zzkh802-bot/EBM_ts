import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import EvidencePage from './pages/EvidencePage.vue'
import KnowledgePage from './pages/KnowledgePage.vue'
import LiteraturePage from './pages/LiteraturePage.vue'
import './styles/index.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/evidence' },
    { path: '/evidence', component: EvidencePage },
    { path: '/knowledge', component: KnowledgePage },
    { path: '/literature', component: LiteraturePage },
  ],
})

createApp(App).use(createPinia()).use(router).mount('#app')
