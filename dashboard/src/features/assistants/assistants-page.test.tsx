import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantForm } from './assistants-page';

describe('AssistantForm', () => {
  it('does not render write controls for an AGENT', () => {
    render(<AssistantForm canManage={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /save|create/i })).toBeNull();
  });

  it('validates a blank assistant name before submitting', () => {
    const onSubmit = vi.fn();
    render(<AssistantForm canManage onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /create assistant/i }));
    expect(screen.getByText('Assistant name is required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

