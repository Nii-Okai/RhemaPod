import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AuthProvider, useAuthGuard } from '../AuthContext';
import * as session from '../session';
import type { AuthStatus } from '../types';
import { clearPendingLink, PENDING_LINK_TTL_MS, stashPendingLink, takePendingLink } from '../../linking/pendingLink';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSegments: string[] = [];
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSegments: () => mockSegments,
}));
jest.mock('../googleSignIn', () => ({ configureGoogleSignIn: jest.fn() }));

let listener: ((s: AuthStatus) => void) | null = null;
jest.mock('../session', () => ({
  getStatus: jest.fn(),
  subscribe: jest.fn((cb) => {
    listener = cb;
    return () => {
      listener = null;
    };
  }),
  bootstrap: jest.fn(() => Promise.resolve()),
}));

const mockedStatus = session.getStatus as jest.Mock;

function Guard() {
  useAuthGuard();
  return null;
}
// A fresh element per call: re-rendering the identical element would bail out.
const tree = () => (
  <AuthProvider>
    <Guard />
  </AuthProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingLink();
  mockSegments = [];
  listener = null;
});

describe('shared-link replay', () => {
  it('signed out: stash survives, then replays exactly once after sign-in lands on home', () => {
    mockedStatus.mockReturnValue('signedOut');
    mockSegments = ['(auth)', 'sign-in'];
    stashPendingLink('/sermon/a');
    const view = render(tree());
    expect(mockPush).not.toHaveBeenCalled();

    // Sign-in succeeds: the guard sends the user to home...
    act(() => listener?.('signedIn'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
    expect(mockPush).not.toHaveBeenCalled();

    // ...and once home is mounted the stash is pushed on top of it.
    mockSegments = ['(tabs)', 'home'];
    view.rerender(tree());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/sermon/a');

    mockSegments = ['(tabs)', 'library'];
    view.rerender(tree());
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('signed out: a stashed /playlist/<uuid> link replays after sign-in lands on home', () => {
    const target = '/playlist/3f1c2b7e-9a41-4d6e-8c55-0b1e7a2d9f10';
    mockedStatus.mockReturnValue('signedOut');
    mockSegments = ['(auth)', 'sign-in'];
    stashPendingLink(target);
    const view = render(tree());
    act(() => listener?.('signedIn'));
    expect(mockPush).not.toHaveBeenCalled();
    mockSegments = ['(tabs)', 'home'];
    view.rerender(tree());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(target);
  });

  it('cold start, already signed in: home first, then the target', () => {
    mockedStatus.mockReturnValue('signedIn');
    mockSegments = ['index'];
    stashPendingLink('/series/b');
    const view = render(tree());
    expect(mockPush).not.toHaveBeenCalled();
    mockSegments = ['(tabs)', 'home'];
    view.rerender(tree());
    expect(mockPush).toHaveBeenCalledWith('/series/b');
  });

  it('cold start while bootstrapping: stash, loading, then signedIn and home -> exactly one push', () => {
    mockedStatus.mockReturnValue('loading');
    mockSegments = ['index'];
    stashPendingLink('/sermon/a');
    const view = render(tree());
    expect(mockPush).not.toHaveBeenCalled();

    mockedStatus.mockReturnValue('signedIn');
    act(() => listener?.('signedIn'));
    mockSegments = ['(tabs)', 'home'];
    view.rerender(tree());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/sermon/a');

    view.rerender(tree());
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('nothing stashed: signed in on home pushes nothing', () => {
    mockedStatus.mockReturnValue('signedIn');
    mockSegments = ['(tabs)', 'home'];
    render(tree());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('an expired stash is not replayed', () => {
    mockedStatus.mockReturnValue('signedIn');
    mockSegments = ['(tabs)', 'home'];
    const now = Date.now();
    stashPendingLink('/sermon/a');
    jest.spyOn(Date, 'now').mockReturnValue(now + PENDING_LINK_TTL_MS + 1);
    render(tree());
    expect(mockPush).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('a sign-out clears the stash', () => {
    mockedStatus.mockReturnValue('signedIn');
    mockSegments = ['index'];
    render(tree());
    stashPendingLink('/sermon/a');
    act(() => listener?.('signedOut'));
    expect(takePendingLink()).toBeNull();
  });

  it('a stash made while signed out is not cleared by the status staying signedOut', () => {
    mockedStatus.mockReturnValue('signedOut');
    mockSegments = ['(auth)', 'sign-in'];
    render(tree());
    stashPendingLink('/sermon/a');
    act(() => listener?.('signedOut'));
    expect(takePendingLink()).toBe('/sermon/a');
  });
});
