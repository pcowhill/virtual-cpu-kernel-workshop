import { createApp } from 'vue';
import App from './App.vue';
import './ui/styles/base.css';
import { registerServiceWorker } from './pwa';

createApp(App).mount('#app');
registerServiceWorker();
