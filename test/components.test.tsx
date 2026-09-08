// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MessageBubble } from '@/components/MessageBubble';
import { SourceList, collectCaveats, collectSources } from '@/components/SourceList';
import { ToolTrace } from '@/components/ToolTrace';
import type { ToolTraceEntry, UiMessage } from '@/lib/chat/reducer';

function tool(overrides: Partial<ToolTraceEntry> = {}): ToolTraceEntry {
  return {
    id: 't1',
    name: 'companion_check',
    input: { plant_a: 'tomato', plant_b: 'potato' },
    status: 'ok',
    result: { verdict: 'bad' },
    ...overrides,
  };
}

function assistant(overrides: Partial<UiMessage> = {}): UiMessage {
  return { id: 'a1', role: 'assistant', content: '', tools: [], ...overrides };
}

describe('ToolTrace', () => {
  it('names the tool and shows the arguments it was called with', () => {
    render(<ToolTrace tool={tool()} />);

    expect(screen.getByText('companion_check')).toBeInTheDocument();
    expect(screen.getByText(/"plant_a":"tomato"/)).toBeInTheDocument();
  });

  it('shows a call still in flight as running and refuses to expand it', () => {
    render(<ToolTrace tool={tool({ status: 'running', result: undefined })} />);

    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('reveals the raw result when expanded', async () => {
    const user = userEvent.setup();
    render(<ToolTrace tool={tool()} />);

    expect(screen.queryByText(/"verdict"/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button'));

    expect(screen.getByText(/"verdict": "bad"/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks a failed call as failed rather than hiding it', () => {
    render(<ToolTrace tool={tool({ status: 'failed', result: 'Perenual returned HTTP 503.' })} />);

    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});

describe('collectSources / collectCaveats', () => {
  it('gathers sources across tools and de-duplicates them', () => {
    const sources = collectSources([
      tool({ id: 'a', result: { sources: [{ name: 'Perenual', url: 'u', license: 'terms' }] } }),
      tool({ id: 'b', result: { sources: [{ name: 'Perenual', url: 'u', license: 'terms' }, { name: 'Open-Meteo', url: 'v', license: 'CC BY 4.0' }] } }),
    ]);

    expect(sources.map((source) => source.name)).toEqual(['Perenual', 'Open-Meteo']);
  });

  it('ignores tools that returned no sources', () => {
    expect(collectSources([tool({ result: 'plain text' })])).toEqual([]);
  });

  it('gathers caveats across tools', () => {
    expect(
      collectCaveats([tool({ result: { caveats: ['ERA5 is gridded', 'ERA5 is gridded'] } })]),
    ).toEqual(['ERA5 is gridded']);
  });
});

describe('SourceList', () => {
  it('renders each source with its licence', () => {
    render(
      <SourceList
        tools={[tool({ result: { sources: [{ name: 'Permapeople', url: 'https://p.test', license: 'CC BY-SA 4.0' }] } })]}
      />,
    );

    const region = screen.getByRole('region', { name: 'Sources' });
    expect(within(region).getByRole('link', { name: 'Permapeople' })).toHaveAttribute(
      'href',
      'https://p.test',
    );
    expect(within(region).getByText(/CC BY-SA 4.0/)).toBeInTheDocument();
  });

  it('renders nothing when no tool reported a source', () => {
    render(<SourceList tools={[]} />);

    expect(screen.queryByRole('region', { name: 'Sources' })).not.toBeInTheDocument();
  });
});

describe('MessageBubble', () => {
  it('renders the question as written', () => {
    render(
      <MessageBubble message={{ id: 'u1', role: 'user', content: 'Tomatoes?', tools: [] }} streaming={false} />,
    );

    expect(screen.getByText('Tomatoes?')).toBeInTheDocument();
  });

  it('shows a thinking hint before anything has streamed', () => {
    render(<MessageBubble message={assistant()} streaming />);

    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });

  it('renders partial text as it streams', () => {
    render(<MessageBubble message={assistant({ content: 'Keep them ap' })} streaming />);

    expect(screen.getByText(/Keep them ap/)).toBeInTheDocument();
  });

  it('surfaces caveats rather than burying them', () => {
    render(
      <MessageBubble
        message={assistant({
          content: 'Late April.',
          tools: [tool({ result: { caveats: ['Frost dates come from a 9 km grid.'] } })],
        })}
        streaming={false}
      />,
    );

    const caveats = screen.getByRole('region', { name: 'Caveats' });
    expect(within(caveats).getByText(/9 km grid/)).toBeInTheDocument();
  });

  it('announces an error with its remedy', () => {
    render(
      <MessageBubble
        message={assistant({ error: { message: 'Perenual is down.', remedy: 'Retry shortly.' } })}
        streaming={false}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Perenual is down.')).toBeInTheDocument();
    expect(within(alert).getByText('Retry shortly.')).toBeInTheDocument();
  });

  it('lists the tools it used', () => {
    render(
      <MessageBubble
        message={assistant({ content: 'ok', tools: [tool(), tool({ id: 't2', name: 'planting_window' })] })}
        streaming={false}
      />,
    );

    const region = screen.getByRole('region', { name: 'Tools used' });
    expect(within(region).getByText('companion_check')).toBeInTheDocument();
    expect(within(region).getByText('planting_window')).toBeInTheDocument();
  });
});
