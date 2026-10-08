# MediaWiki 1.43.x on PHP 8.4.
# The official mediawiki:1.43 image ships PHP 8.3, so this image rebuilds the
# same stack on php:8.4-apache and copies the MediaWiki tree from the official
# image. Build steps follow the official mediawiki Dockerfile.
ARG MW_IMAGE=mediawiki:1.43
FROM ${MW_IMAGE} AS mw

FROM php:8.4-apache

RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends \
		git \
		imagemagick \
		librsvg2-bin \
		libicu-dev \
		libonig-dev \
	; \
	docker-php-ext-install -j "$(nproc)" calendar intl mbstring opcache; \
	pecl install APCu; \
	docker-php-ext-enable apcu; \
	rm -rf /tmp/pear /var/lib/apt/lists/*

# Dev: revalidate PHP files on every request so edits in the mounted
# extension are picked up at once.
RUN { \
		echo 'opcache.memory_consumption=128'; \
		echo 'opcache.interned_strings_buffer=8'; \
		echo 'opcache.max_accelerated_files=10000'; \
		echo 'opcache.validate_timestamps=1'; \
		echo 'opcache.revalidate_freq=0'; \
	} > /usr/local/etc/php/conf.d/opcache-dev.ini; \
	{ \
		echo 'memory_limit=512M'; \
		echo 'upload_max_filesize=50M'; \
		echo 'post_max_size=55M'; \
		echo 'display_errors=Off'; \
		echo 'log_errors=On'; \
	} > /usr/local/etc/php/conf.d/mediawiki-dev.ini

RUN set -eux; \
	a2enmod rewrite; \
	{ \
		echo "<Directory /var/www/html>"; \
		echo "  RewriteEngine On"; \
		echo "  RewriteCond %{REQUEST_FILENAME} !-f"; \
		echo "  RewriteCond %{REQUEST_FILENAME} !-d"; \
		echo "  RewriteRule ^ %{DOCUMENT_ROOT}/index.php [L]"; \
		echo "</Directory>"; \
	} > "$APACHE_CONFDIR/conf-available/short-url.conf"; \
	a2enconf short-url; \
	sed -i "s/<\/VirtualHost>/\tAllowEncodedSlashes NoDecode\n<\/VirtualHost>/" "$APACHE_CONFDIR/sites-available/000-default.conf"

COPY --from=mw /var/www/html /var/www/html
RUN set -eux; \
	mkdir -p /var/www/data; \
	chown -R www-data:www-data /var/www/data /var/www/html/images

WORKDIR /var/www/html
