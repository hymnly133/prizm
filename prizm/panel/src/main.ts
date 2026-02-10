import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Overview from './views/Overview.vue'
import Permissions from './views/Permissions.vue'
import Notes from './views/Notes.vue'
import Notify from './views/Notify.vue'

const router = createRouter({
  history: createWebHistory('/dashboard/'),
  routes: [
    { path: '/', name: 'Overview', component: Overview },
    { path: '/permissions', name: 'Permissions', component: Permissions },
    { path: '/notes', name: 'Notes', component: Notes },
    { path: '/notify', name: 'Notify', component: Notify }
  ]
})

const app = createApp(App)
app.use(router)
app.mount('#app')
