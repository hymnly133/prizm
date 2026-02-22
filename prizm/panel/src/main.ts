import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Overview from './views/Overview.vue'
import Permissions from './views/Permissions.vue'
import Notes from './views/Notes.vue'
import Notify from './views/Notify.vue'
import Tasks from './views/Tasks.vue'
import Clipboard from './views/Clipboard.vue'
import Documents from './views/Documents.vue'
import Agent from './views/Agent.vue'
import Settings from './views/Settings.vue'
import TokenStats from './views/TokenStats.vue'
import Audit from './views/Audit.vue'

const router = createRouter({
  history: createWebHistory('/dashboard/'),
  routes: [
    { path: '/', name: 'Overview', component: Overview },
    { path: '/permissions', name: 'Permissions', component: Permissions },
    { path: '/notes', name: 'Notes', component: Notes },
    { path: '/notify', name: 'Notify', component: Notify },
    { path: '/todo', name: 'Tasks', component: Tasks },
    { path: '/clipboard', name: 'Clipboard', component: Clipboard },
    { path: '/documents', name: 'Documents', component: Documents },
    { path: '/agent', name: 'Agent', component: Agent },
    { path: '/token-stats', name: 'TokenStats', component: TokenStats },
    { path: '/audit', name: 'Audit', component: Audit },
    { path: '/settings', name: 'Settings', component: Settings }
  ]
})

const app = createApp(App)
app.use(router)
app.mount('#app')
