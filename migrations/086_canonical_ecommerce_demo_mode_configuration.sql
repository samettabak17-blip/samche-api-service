-- Migration 086: Canonical E-Commerce Demo Mode Configuration
-- Idempotently configures generic demo_mode for e-commerce demonstration tenants (SamChe Technology / Task 8).
-- Preserves strict tenant isolation and pure white-label defaults for all non-demo tenants.

BEGIN;

-- 1. Update assistant_configuration_versions for SamChe Technology / Task 8 demo tenant
UPDATE assistant_configuration_versions
   SET configuration_data = jsonb_set(
         COALESCE(configuration_data, '{}'::jsonb),
         '{demo_mode}',
         jsonb_build_object(
           'enabled', true,
           'platform_name', 'SamChe AI',
           'business_name', 'SamChe Technology',
           'business_type', 'e-commerce store',
           'business_context', 'For this demonstration, SamChe Technology represents an e-commerce electronics and consumer tech store.',
           'disclosure', 'This is an e-commerce demonstration experience powered by SamChe AI.',
           'transition_behavior', 'continue_as_tenant_assistant',
           'welcome_title', 'Welcome to the SamChe AI Demo',
           'webchat_welcome', E'Welcome to the SamChe AI Demo\n\nYou\'re exploring SamChe Technology, an e-commerce demo powered by SamChe AI. I can help you discover and compare products, answer questions about the products you\'re viewing, and assist with orders, delivery, returns and other support questions.\n\nTry one of the examples below or ask me anything.',
           'scenarios', jsonb_build_array(
             jsonb_build_object('id', 'compare_products', 'label', 'Compare products', 'prompt', 'Can you compare the top products in your catalog?'),
             jsonb_build_object('id', 'choose_product', 'label', 'Help me choose a product', 'prompt', 'Help me choose the right product for my needs.'),
             jsonb_build_object('id', 'order_status', 'label', 'Where is my order?', 'prompt', 'Where is my order and how can I track it?'),
             jsonb_build_object('id', 'product_problem', 'label', 'I have a problem with a product', 'prompt', 'I have a problem with a product I received.'),
             jsonb_build_object('id', 'return_policy', 'label', 'What is your return policy?', 'prompt', 'What is your return and refund policy?')
           ),
           'translations', jsonb_build_object(
             'tr', jsonb_build_object(
               'welcome_title', 'SamChe AI Demosuna Hoş Geldiniz',
               'webchat_welcome', E'SamChe AI Demosuna Hoş Geldiniz\n\nSamChe AI tarafından desteklenen bir e-ticaret demosu olan SamChe Teknoloji\'yi keşfediyorsunuz. Ürünleri keşfetmenize ve karşılaştırmanıza, görüntülediğiniz ürünlerle ilgili soruları yanıtlamanıza ve siparişler, teslimat, iadeler ve diğer destek sorularında yardımcı olabilirim.\n\nAşağıdaki örneklerden birini deneyin veya bana herhangi bir şey sorun.',
               'chips', jsonb_build_array('Ürünleri karşılaştır', 'Ürün seçmeme yardım et', 'Siparişim nerede?', 'Ürünümle ilgili bir sorun var', 'İade politikanız nedir?'),
               'scenarios', jsonb_build_array(
                 jsonb_build_object('id', 'compare_products', 'label', 'Ürünleri karşılaştır', 'prompt', 'Katalogdaki popüler ürünleri karşılaştırabilir misiniz?'),
                 jsonb_build_object('id', 'choose_product', 'label', 'Ürün seçmeme yardım et', 'prompt', 'İhtiyacıma uygun doğru ürünü seçmeme yardımcı olur musunuz?'),
                 jsonb_build_object('id', 'order_status', 'label', 'Siparişim nerede?', 'prompt', 'Siparişim nerede ve nasıl takip edebilirim?'),
                 jsonb_build_object('id', 'product_problem', 'label', 'Ürünümle ilgili bir sorun var', 'prompt', 'Satın aldığım bir ürünle ilgili sorun yaşıyorum.'),
                 jsonb_build_object('id', 'return_policy', 'label', 'İade politikanız nedir?', 'prompt', 'İade ve değişim politikanız nedir?')
               )
             ),
             'ar', jsonb_build_object(
               'welcome_title', 'مرحباً بكم في عرض SamChe AI التجريبي',
               'webchat_welcome', E'مرحباً بكم في عرض SamChe AI التجريبي\n\nأنت تستكشف الآن SamChe Technology، وهو عرض تجريبي للتجارة الإلكترونية مدعوم بـ SamChe AI. يمكنني مساعدتك في استكشاف المنتجات ومقارنتها، والإجابة على الأسئلة المتعلقة بالمنتجات التي تتصفحها، والمساعدة في الطلبات والتوصيل والإرجاع واستفسارات الدعم الأخرى.\n\nجرّب أحد الأمثلة أدناه أو اسألني أي شيء.',
               'chips', jsonb_build_array('مقارنة المنتجات', 'ساعدني في اختيار منتج', 'أين طلبي؟', 'لدي مشكلة في منتج', 'ما هي سياسة الإرجاع؟'),
               'scenarios', jsonb_build_array(
                 jsonb_build_object('id', 'compare_products', 'label', 'مقارنة المنتجات', 'prompt', 'هل يمكنك مقارنة أبرز المنتجات في الكتالوج؟'),
                 jsonb_build_object('id', 'choose_product', 'label', 'ساعدني في اختيار منتج', 'prompt', 'ساعدني في اختيار المنتج المناسب لاحتياجاتي.'),
                 jsonb_build_object('id', 'order_status', 'label', 'أين طلبي؟', 'prompt', 'أين طلبي وكيف يمكنني تتبعه؟'),
                 jsonb_build_object('id', 'product_problem', 'label', 'لدي مشكلة في منتج', 'prompt', 'لدي مشكلة في منتج استلمته.'),
                 jsonb_build_object('id', 'return_policy', 'label', 'ما هي سياسة الإرجاع؟', 'prompt', 'ما هي سياسة الإرجاع واسترداد الأموال لديكم؟')
               )
             )
           )
         ),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%SamChe Teknoloji%' OR name ILIKE '%SamChe Technology%' OR name ILIKE '%Task 8%');


-- 2. Update channel_integrations for SamChe Technology / Task 8 demo tenant
UPDATE channel_integrations
   SET config = jsonb_set(
         COALESCE(config, '{}'::jsonb),
         '{demo_mode}',
         jsonb_build_object(
           'enabled', true,
           'platform_name', 'SamChe AI',
           'business_name', 'SamChe Technology',
           'business_type', 'e-commerce store',
           'business_context', 'For this demonstration, SamChe Technology represents an e-commerce electronics and consumer tech store.',
           'disclosure', 'This is an e-commerce demonstration experience powered by SamChe AI.',
           'transition_behavior', 'continue_as_tenant_assistant',
           'welcome_title', 'Welcome to the SamChe AI Demo',
           'webchat_welcome', E'Welcome to the SamChe AI Demo\n\nYou\'re exploring SamChe Technology, an e-commerce demo powered by SamChe AI. I can help you discover and compare products, answer questions about the products you\'re viewing, and assist with orders, delivery, returns and other support questions.\n\nTry one of the examples below or ask me anything.',
           'scenarios', jsonb_build_array(
             jsonb_build_object('id', 'compare_products', 'label', 'Compare products', 'prompt', 'Can you compare the top products in your catalog?'),
             jsonb_build_object('id', 'choose_product', 'label', 'Help me choose a product', 'prompt', 'Help me choose the right product for my needs.'),
             jsonb_build_object('id', 'order_status', 'label', 'Where is my order?', 'prompt', 'Where is my order and how can I track it?'),
             jsonb_build_object('id', 'product_problem', 'label', 'I have a problem with a product', 'prompt', 'I have a problem with a product I received.'),
             jsonb_build_object('id', 'return_policy', 'label', 'What is your return policy?', 'prompt', 'What is your return and refund policy?')
           ),
           'translations', jsonb_build_object(
             'tr', jsonb_build_object(
               'welcome_title', 'SamChe AI Demosuna Hoş Geldiniz',
               'webchat_welcome', E'SamChe AI Demosuna Hoş Geldiniz\n\nSamChe AI tarafından desteklenen bir e-ticaret demosu olan SamChe Teknoloji\'yi keşfediyorsunuz. Ürünleri keşfetmenize ve karşılaştırmanıza, görüntülediğiniz ürünlerle ilgili soruları yanıtlamanıza ve siparişler, teslimat, iadeler ve diğer destek sorularında yardımcı olabilirim.\n\nAşağıdaki örneklerden birini deneyin veya bana herhangi bir şey sorun.',
               'chips', jsonb_build_array('Ürünleri karşılaştır', 'Ürün seçmeme yardım et', 'Siparişim nerede?', 'Ürünümle ilgili bir sorun var', 'İade politikanız nedir?'),
               'scenarios', jsonb_build_array(
                 jsonb_build_object('id', 'compare_products', 'label', 'Ürünleri karşılaştır', 'prompt', 'Katalogdaki popüler ürünleri karşılaştırabilir misiniz?'),
                 jsonb_build_object('id', 'choose_product', 'label', 'Ürün seçmeme yardım et', 'prompt', 'İhtiyacıma uygun doğru ürünü seçmeme yardımcı olur musunuz?'),
                 jsonb_build_object('id', 'order_status', 'label', 'Siparişim nerede?', 'prompt', 'Siparişim nerede ve nasıl takip edebilirim?'),
                 jsonb_build_object('id', 'product_problem', 'label', 'Ürünümle ilgili bir sorun var', 'prompt', 'Satın aldığım bir ürünle ilgili sorun yaşıyorum.'),
                 jsonb_build_object('id', 'return_policy', 'label', 'İade politikanız nedir?', 'prompt', 'İade ve değişim politikanız nedir?')
               )
             ),
             'ar', jsonb_build_object(
               'welcome_title', 'مرحباً بكم في عرض SamChe AI التجريبي',
               'webchat_welcome', E'مرحباً بكم في عرض SamChe AI التجريبي\n\nأنت تستكشف الآن SamChe Technology، وهو عرض تجريبي للتجارة الإلكترونية مدعوم بـ SamChe AI. يمكنني مساعدتك في استكشاف المنتجات ومقارنتها، والإجابة على الأسئلة المتعلقة بالمنتجات التي تتصفحها، والمساعدة في الطلبات والتوصيل والإرجاع واستفسارات الدعم الأخرى.\n\nجرّب أحد الأمثلة أدناه أو اسألني أي شيء.',
               'chips', jsonb_build_array('مقارنة المنتجات', 'ساعدني في اختيار منتج', 'أين طلبي؟', 'لدي مشكلة في منتج', 'ما هي سياسة الإرجاع؟'),
               'scenarios', jsonb_build_array(
                 jsonb_build_object('id', 'compare_products', 'label', 'مقارنة المنتجات', 'prompt', 'هل يمكنك مقارنة أبرز المنتجات في الكتالوج؟'),
                 jsonb_build_object('id', 'choose_product', 'label', 'ساعدني في اختيار منتج', 'prompt', 'ساعدني في اختيار المنتج المناسب لاحتياجاتي.'),
                 jsonb_build_object('id', 'order_status', 'label', 'أين طلبي؟', 'prompt', 'أين طلبي وكيف يمكنني تتبعه؟'),
                 jsonb_build_object('id', 'product_problem', 'label', 'لدي مشكلة في منتج', 'prompt', 'لدي مشكلة في منتج استلمته.'),
                 jsonb_build_object('id', 'return_policy', 'label', 'ما هي سياسة الإرجاع؟', 'prompt', 'ما هي سياسة الإرجاع واسترداد الأموال لديكم؟')
               )
             )
           )
         ),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%SamChe Teknoloji%' OR name ILIKE '%SamChe Technology%' OR name ILIKE '%Task 8%');

COMMIT;
