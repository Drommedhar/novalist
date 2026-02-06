import { App } from 'obsidian';

export interface TourStep {
    selector: string;
    title: string;
    content: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    onShow?: () => Promise<void> | void;
}

export class TourGuide {
    app: App;
    steps: TourStep[];
    currentStepIndex: number = -1;
    currentBubble: HTMLElement | null = null;
    currentHighlight: HTMLElement | null = null;
    cleanupCallbacks: (() => void)[] = [];

    constructor(app: App, steps: TourStep[]) {
        this.app = app;
        this.steps = steps;
    }

    start() {
        if (this.steps.length > 0) {
            void this.showStep(0);
        }
    }

    async showStep(index: number) {
        this.clearStep();
        
        if (index < 0 || index >= this.steps.length) {
            this.end();
            return;
        }

        this.currentStepIndex = index;
        const step = this.steps[index];

        if (step.onShow) {
            await step.onShow();
            // Wait a tiny bit for UI to settle
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        // Retry finding element a few times if not immediately available
        let target = document.querySelector(step.selector);
        if (!target) {
            for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 200));
                target = document.querySelector(step.selector);
                if (target) break;
            }
        }

        if (!target) {
            // console.warn(`TourGuide: target not found for step ${index} (${step.selector}). Skipping.`);
            this.next();
            return;
        }

        this.highlightElement(target as HTMLElement);
        this.createBubble(target as HTMLElement, step);
    }

    next() {
        void this.showStep(this.currentStepIndex + 1);
    }

    end() {
        this.clearStep();
    }

    private clearStep() {
        if (this.currentBubble) {
            this.currentBubble.remove();
            this.currentBubble = null;
        }
        if (this.currentHighlight) {
            this.currentHighlight.removeClass('novalist-tour-target');
            this.currentHighlight = null;
        }
        this.cleanupCallbacks.forEach(cb => cb());
        this.cleanupCallbacks = [];
    }

    private highlightElement(el: HTMLElement) {
        el.addClass('novalist-tour-target');
        this.currentHighlight = el;
    }

    private createBubble(target: HTMLElement, step: TourStep) {
        const bubble = document.body.createDiv('novalist-tour-bubble');
        this.currentBubble = bubble;

        bubble.createEl('h3', { text: step.title });
        bubble.createEl('p', { text: step.content });

        const btnContainer = bubble.createDiv('novalist-tour-buttons');

        const skipBtn = btnContainer.createEl('button', { text: 'Skip tour' });
        skipBtn.onclick = () => this.end();

        const nextBtn = btnContainer.createEl('button', { text: this.currentStepIndex === this.steps.length - 1 ? 'Finish' : 'Next' });
        nextBtn.addClass('mod-cta');
        nextBtn.onclick = () => this.next();

        // Positioning
        this.positionBubble(bubble, target, step.position || 'bottom');
        
        // Handle window resize
        const resizeHandler = () => this.positionBubble(bubble, target, step.position || 'bottom');
        window.addEventListener('resize', resizeHandler);
        this.cleanupCallbacks.push(() => window.removeEventListener('resize', resizeHandler));
    }

    private positionBubble(bubble: HTMLElement, target: HTMLElement, position: 'top' | 'bottom' | 'left' | 'right') {
        const rect = target.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const spacing = 15;

        let top = 0;
        let left = 0;

        switch (position) {
            case 'top':
                top = rect.top - bubbleRect.height - spacing;
                left = rect.left + (rect.width / 2) - (bubbleRect.width / 2);
                break;
            case 'bottom':
                top = rect.bottom + spacing;
                left = rect.left + (rect.width / 2) - (bubbleRect.width / 2);
                break;
            case 'left':
                top = rect.top + (rect.height / 2) - (bubbleRect.height / 2);
                left = rect.left - bubbleRect.width - spacing;
                break;
            case 'right':
                top = rect.top + (rect.height / 2) - (bubbleRect.height / 2);
                left = rect.right + spacing;
                break;
        }

        // Keep viewport bounds
        if (left < 10) left = 10;
        if (left + bubbleRect.width > window.innerWidth - 10) left = window.innerWidth - bubbleRect.width - 10;
        if (top < 10) top = 10;
        if (top + bubbleRect.height > window.innerHeight - 10) top = window.innerHeight - bubbleRect.height - 10;

        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;

        // Calculate arrow offset
        let arrowOffset = 0;
        if (position === 'top' || position === 'bottom') {
            const targetCenter = rect.left + (rect.width / 2);
            arrowOffset = targetCenter - left;
            // Clamp arrow to stay within bubble border radius
            const padding = 20; // border radius + arrow width
            if (arrowOffset < padding) arrowOffset = padding;
            if (arrowOffset > bubbleRect.width - padding) arrowOffset = bubbleRect.width - padding;
        } else {
             const targetCenter = rect.top + (rect.height / 2);
             arrowOffset = targetCenter - top;
             const padding = 20;
             if (arrowOffset < padding) arrowOffset = padding;
             if (arrowOffset > bubbleRect.height - padding) arrowOffset = bubbleRect.height - padding;
        }
        bubble.style.setProperty('--arrow-offset', `${arrowOffset}px`);

        // Add arrow class
        bubble.removeClass('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');
        switch (position) {
            case 'bottom': bubble.addClass('arrow-top'); break; // arrow points top
            case 'top': bubble.addClass('arrow-bottom'); break; // arrow points bottom
            case 'right': bubble.addClass('arrow-left'); break; // arrow points left
            case 'left': bubble.addClass('arrow-right'); break; // arrow points right
        }
    }
}
