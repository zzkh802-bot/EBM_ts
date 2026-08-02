import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createAppRouter } from './router'
import './styles/index.css'

const router = createAppRouter()

createApp(App).use(createPinia()).use(router).mount('#app')
