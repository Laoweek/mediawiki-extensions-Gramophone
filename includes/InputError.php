<?php

namespace MediaWiki\Extension\Gramophone;

use Exception;

/**
 * Invalid tag content. The exception message is the i18n key that explains the problem.
 */
class InputError extends Exception {

	/**
	 * @param string $messageKey For example `gramophone-invalidJson`
	 */
	public function __construct( string $messageKey ) {
		parent::__construct( $messageKey );
	}

	public function getMessageKey(): string {
		return $this->getMessage();
	}
}
