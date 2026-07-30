import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import EvidencePage from './pages/EvidencePage.vue'
import './styles/index.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/evidence' },
    { path: '/evidence', component: EvidencePage },
    { path: '/knowledge', redirect: '/evidence' },
    { path: '/literature', redirect: '/evidence' },
    { path: '/:pathMatch(.*)*', redirect: '/evidence' },
  ],
})

createApp(App).use(createPinia()).use(router).mount('#app')
