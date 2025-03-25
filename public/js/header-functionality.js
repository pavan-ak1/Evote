const menuToggle = document.getElementById('menu-toggle');
        const sidebarClose = document.getElementById('sidebar-close');
        const mobileSidebar = document.getElementById('mobile-sidebar');
        const overlay = document.getElementById('overlay');

        menuToggle.addEventListener('click', () => {
            mobileSidebar.classList.remove('-translate-x-full');
            overlay.classList.add('opacity-50');
            overlay.classList.remove('pointer-events-none');
        });

        sidebarClose.addEventListener('click', closeSidebar);
        overlay.addEventListener('click', closeSidebar);

        function closeSidebar() {
            mobileSidebar.classList.add('-translate-x-full');
            overlay.classList.remove('opacity-50');
            overlay.classList.add('pointer-events-none');
        }
        
        function redirectTo(page) {
            window.location.href = page;
        }
        