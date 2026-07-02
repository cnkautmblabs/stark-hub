-- Limita o bucket de avatares a imagens de até 2MB, evitando uploads
-- indevidos (arquivos grandes ou de outros tipos) via a mesma URL pública.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'avatars';
