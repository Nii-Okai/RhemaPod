import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CodeInput } from '../code-input';

describe('CodeInput', () => {
  it('keeps digits only, caps at six, and fires onComplete once the code is whole', () => {
    const onChangeText = jest.fn();
    const onComplete = jest.fn();
    const { getByLabelText } = render(<CodeInput value="" onChangeText={onChangeText} onComplete={onComplete} />);

    fireEvent.changeText(getByLabelText('Verification code'), '12-34 5678');

    expect(onChangeText).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('does not fire onComplete for a partial code', () => {
    const onComplete = jest.fn();
    const { getByLabelText } = render(<CodeInput value="" onChangeText={jest.fn()} onComplete={onComplete} />);

    fireEvent.changeText(getByLabelText('Verification code'), '123');

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('renders each entered digit and the error copy', () => {
    const { getByText } = render(<CodeInput value="42" onChangeText={jest.fn()} error="Invalid or expired code" />);

    expect(getByText('4')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('Invalid or expired code')).toBeTruthy();
  });
});
