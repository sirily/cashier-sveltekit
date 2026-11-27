import Big from 'big.js';

type Operator = '+' | '-' | '×' | '÷';
type Operand = { amount: string; currency?: string; account?: string };
// The unary sign is distinct from binary subtraction and from signed amounts.
type Token = Operand | Operator | '(' | ')' | '−';

function isOperand(token: Token | undefined): token is Operand {
	return typeof token === 'object';
}

function evaluate(tokens: Token[]) {
	let index = 0;
	function term(): Big {
		const token = tokens[index++];
		if (isOperand(token)) return new Big(token.amount.replace(/^\+/, ''));
		if (token === '−') return term().neg();
		if (token !== '(') throw new Error('Expected an operand.');
		const value = expression();
		if (tokens[index++] !== ')') throw new Error('Expected a closing parenthesis.');
		return value;
	}

	function product(): Big {
		let value = term();
		while (tokens[index] === '×' || tokens[index] === '÷') {
			const operator = tokens[index++];
			value = operator === '×' ? value.times(term()) : value.div(term());
		}
		return value;
	}

	function expression(): Big {
		let value = product();
		while (tokens[index] === '+' || tokens[index] === '-') {
			const operator = tokens[index++];
			value = operator === '+' ? value.plus(product()) : value.minus(product());
		}
		return value;
	}

	const result = expression();
	if (index !== tokens.length) throw new Error('Unexpected token.');
	return result.toFixed();
}

export class Calculator {
	tokens = $state<Token[]>([]);
	selected = $state<number | null>(null);
	display = $state('0');
	private evaluated = false;

	reset(value?: string) {
		this.display = value ?? '0';
		this.tokens = value === undefined ? [] : [{ amount: value }];
		this.selected = null;
		this.evaluated = value !== undefined;
	}

	select(index: number) {
		this.selected = index;
	}

	private get tail() {
		return this.tokens.at(-1);
	}

	private get editIndex() {
		if (this.selected !== null) return this.selected;
		return this.tokens.length - (isOperand(this.tail) ? 1 : 0);
	}

	private put(operand: Operand, index = this.editIndex) {
		this.tokens[index] = operand;
		this.display = operand.amount;
		this.evaluated = false;
	}

	insertBalance(operand: Operand) {
		const index =
			this.tail === ')' && this.selected === null
				? this.tokens.findLastIndex(isOperand)
				: this.editIndex;
		this.put(operand, index);
		this.selected = null;
	}

	digit(digit: string) {
		if (this.selected === null && this.evaluated) this.reset();
		if (this.selected === null && this.tail === ')') return;
		const current = this.tokens[this.editIndex];
		const amount = isOperand(current) && !current.currency ? current.amount : '';
		this.put({ amount: amount === '0' ? digit : amount === '-0' ? `-${digit}` : amount + digit });
	}

	decimal() {
		if (this.selected === null && this.evaluated) this.reset();
		if (this.selected === null && this.tail === ')') return;
		const current = this.tokens[this.editIndex];
		const amount = isOperand(current) && !current.currency ? current.amount : '0';
		if (!amount.includes('.')) this.put({ amount: `${amount === '-' ? '-0' : amount}.` });
	}

	operator(operator: Operator) {
		this.selected = null;
		if (this.evaluated) this.tokens = [{ amount: this.display }];
		if (this.tail === ')' || (isOperand(this.tail) && this.tail.amount !== '-')) {
			this.tokens.push(operator);
			this.display = operator;
		} else if (!this.tail || this.tail === '(') {
			if (operator === '-') this.put({ amount: '-' });
		} else if (!isOperand(this.tail)) {
			this.tokens[this.tokens.length - 1] = operator;
			this.display = operator;
		}
		this.evaluated = false;
	}

	parenthesis(paren: '(' | ')') {
		this.selected = null;
		if (paren === '(' && this.evaluated) this.reset();
		if (paren === '(') {
			const tail = this.tail;
			if (tail === ')') return;
			if (isOperand(tail)) {
				if (tail.amount !== '-') return;
				this.tokens[this.tokens.length - 1] = '−';
			}
		}
		if (paren === ')') {
			const depth = this.tokens.reduce(
				(depth, token) => depth + (token === '(' ? 1 : token === ')' ? -1 : 0),
				0
			);
			if (depth === 0 || (this.tail !== ')' && (!isOperand(this.tail) || this.tail.amount === '-')))
				return;
		}
		this.tokens.push(paren);
		this.display = paren;
		this.evaluated = false;
	}

	backspace() {
		const index = this.selected ?? this.tokens.length - 1;
		if (index < 0) return;
		const current = this.tokens[index];
		if (isOperand(current) && !current.currency && current.amount.length > 1) {
			this.put({ amount: current.amount.slice(0, -1) }, index);
		} else if (this.selected === null || index === this.tokens.length - 1) {
			this.tokens.pop();
			if (current === '(' && this.tail === '−') {
				this.tokens[this.tokens.length - 1] = { amount: '-' };
			}
			this.display = isOperand(this.tail) ? this.tail.amount : (this.tail ?? '0');
			this.selected = null;
		} else {
			this.put({ amount: '0' }, index);
		}
		this.evaluated = false;
	}

	toggleSign() {
		if (this.selected === null && this.evaluated) this.tokens = [{ amount: this.display }];
		if (this.selected === null && this.tail === ')') return;
		const current = this.tokens[this.editIndex];
		const amount = isOperand(current) ? current.amount : '';
		this.put({
			amount: amount.startsWith('-') ? amount.slice(1) || '0' : `-${amount.replace(/^\+/, '')}`
		});
	}

	percent() {
		if (this.selected === null && this.evaluated) this.tokens = [{ amount: this.display }];
		const current = this.tokens[this.editIndex];
		if (isOperand(current) && current.amount !== '-') {
			this.put({ amount: new Big(current.amount.replace(/^\+/, '')).times('0.01').toFixed() });
		}
	}

	calculate() {
		this.selected = null;
		try {
			const result = this.tokens.length ? evaluate(this.tokens) : '0';
			this.display = result;
			this.evaluated = true;
			return result;
		} catch {
			this.display = 'Error';
			this.evaluated = false;
			return undefined;
		}
	}
}
