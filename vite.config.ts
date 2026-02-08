import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    server: {
        allowedHosts: [
            'a105-93-177-222-25.ngrok-free.app',
            '.ngrok-free.app' // чтобы разрешить все поддомены ngrok
        ]
    }
});
