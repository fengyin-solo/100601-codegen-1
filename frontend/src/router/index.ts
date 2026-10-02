import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Flight = () => import('@/views/flight/index.vue')
const Stand = () => import('@/views/stand/index.vue')
const Bridge = () => import('@/views/bridge/index.vue')
const Shuttle = () => import('@/views/shuttle/index.vue')
const Baggage = () => import('@/views/baggage/index.vue')
const Line = () => import('@/views/line/index.vue')
const Fueling = () => import('@/views/fueling/index.vue')
const Deice = () => import('@/views/deice/index.vue')
const Gpu = () => import('@/views/gpu/index.vue')
const Tow = () => import('@/views/tow/index.vue')
const Catering = () => import('@/views/catering/index.vue')
const Cabin = () => import('@/views/cabin/index.vue')
const Team = () => import('@/views/team/index.vue')
const Vehmaint = () => import('@/views/vehmaint/index.vue')
const Vip = () => import('@/views/vip/index.vue')
const Delay = () => import('@/views/delay/index.vue')
const Apron = () => import('@/views/apron/index.vue')
const Resplan = () => import('@/views/resplan/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/flight', name: 'flight', component: Flight },
    { path: '/stand', name: 'stand', component: Stand },
    { path: '/bridge', name: 'bridge', component: Bridge },
    { path: '/shuttle', name: 'shuttle', component: Shuttle },
    { path: '/baggage', name: 'baggage', component: Baggage },
    { path: '/line', name: 'line', component: Line },
    { path: '/fueling', name: 'fueling', component: Fueling },
    { path: '/deice', name: 'deice', component: Deice },
    { path: '/gpu', name: 'gpu', component: Gpu },
    { path: '/tow', name: 'tow', component: Tow },
    { path: '/catering', name: 'catering', component: Catering },
    { path: '/cabin', name: 'cabin', component: Cabin },
    { path: '/team', name: 'team', component: Team },
    { path: '/vehmaint', name: 'vehmaint', component: Vehmaint },
    { path: '/vip', name: 'vip', component: Vip },
    { path: '/delay', name: 'delay', component: Delay },
    { path: '/apron', name: 'apron', component: Apron },
    { path: '/resplan', name: 'resplan', component: Resplan },
  ],
})

export default router
