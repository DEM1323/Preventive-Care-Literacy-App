import type { ModuleRecord } from '../types/module';

export const modulesFallback: ModuleRecord = {
      primary: {
        id: "primary",
        icon: "fa-user-doctor text-emerald-600",
        badgeIcon: "🏆",
        badgeName: "Primary Care Champion",
        wordsToPronounce: {
          en: ["Preventive", "Routine Physical", "Referral", "Chronic Illness"],
          es: ["Preventivo", "Físico de rutina", "Referencia", "Enfermedad crónica"],
          pt: ["Preventivo", "Exame físico de rotina", "Encaminhamento", "Doença crônica"],
          fr: ["Préventif", "Examen physique de routine", "Orientation", "Maladie chronique"],
          ht: ["Prevansyon", "Egzamen fizik regilye", "Referans", "Maladi kwonik"]
        },
        content: {
          en: {
            script: "Think about primary care like regular maintenance for your car. You check the engine, do oil changes, and rotate tires to keep the car running smoothly instead of waiting for the engine to fail. Primary doctors and nurses do routine checkups to catch health problems early.",
            knowledges: [
              "<strong>Routine Check-ups:</strong> Yearly physical exams test for high blood pressure, diabetes, and catching risks early.",
              "<strong>Disease Prevention:</strong> Doctors administer life-saving vaccines and guide healthy diet and exercise choices.",
              "<strong>Referrals:</strong> Your primary care doctor acts as a hub, introducing you to specialist physicians when a specific body organ needs focus."
            ],
            skills: [
              "Locate a neighborhood doctor or clinic accessible by public transit/bus routes.",
              "Verify if the medical clinic provides flexible after-school/evening schedules.",
              "Gather and carry your health insurance card, ID, and list of allergies.",
              "Prepare your triage questions ('Routine Physical Appointment' vs 'Same-Day Sick Visit').",
              "Crucial Skill: Call ahead to cancel or reschedule at least 24 hours prior if you cannot make it."
            ]
          },
          es: {
            script: "Piensa en la atención primaria como el mantenimiento regular de un automóvil. Revisas el motor, haces cambios de aceite y rotas las llantas para mantenerlo funcionando sin problemas en lugar de esperar a que se dañe. Los médicos de cabecera hacen lo mismo por tu cuerpo.",
            knowledges: [
              "<strong>Chequeos de rutina:</strong> Exámenes físicos anuales para detectar presión alta, diabetes y riesgos tempranos.",
              "<strong>Prevención de enfermedades:</strong> Los médicos administran vacunas vitales y guían tus hábitos de alimentación y ejercicio.",
              "<strong>Referencias:</strong> Tu médico principal actúa como centro y te refiere a especialistas si necesitas atención en un órgano en específico."
            ],
            skills: [
              "Localiza un médico o clínica del vecindario accesible en transporte público.",
              "Verifica si la clínica médica tiene horarios flexibles después de la escuela.",
              "Reúne y lleva siempre tu tarjeta de seguro de salud, identificación y lista de alergias.",
              "Prepara tus preguntas para agendar ('Cita física de rutina' vs 'Visita por enfermedad hoy mismo').",
              "Habilidad crucial: Llama para cancelar o reprogramar con al menos 24 horas de anticipación si no puedes asistir."
            ]
          },
          pt: {
            script: "Pense nos cuidados primários como a manutenção regular de um carro. Você verifica o motor, troca o óleo e faz o alinhamento dos pneus para manter o carro funcionando bem, em vez de esperar que o motor quebre. Médicos e enfermeiros fazem exames de rotina para identificar problemas de saúde cedo.",
            knowledges: [
              "<strong>Exames de Rotina:</strong> Check-ups anuais para avaliar pressão arterial, diabetes e detectar riscos precocemente.",
              "<strong>Prevenção de Doenças:</strong> Médicos administram vacinas importantes e orientam sobre alimentação saudável e exercícios.",
              "<strong>Encaminhamentos:</strong> Seu médico de cuidados primários atua como uma base central, encaminhando você a médicos especialistas quando necessário."
            ],
            skills: [
              "Encontre um consultório médico ou clínica no bairro de fácil acesso por ônibus ou metrô.",
              "Verifique se a clínica médica oferece horários flexíveis após o período escolar.",
              "Organize e leve sempre o seu cartão do seguro de saúde, documento de identidade e lista de alergias.",
              "Prepare as perguntas de triagem ('Consulta de rotina' vs 'Consulta de urgência por doença').",
              "Habilidade Crucial: Ligue para cancelar ou reagendar com pelo menos 24 horas de antecedência se não puder comparecer."
            ]
          },
          fr: {
            script: "Considérez les soins primaires comme l'entretien régulier de votre voiture. Vous vérifiez le moteur, faites les vidanges et permutez les pneus pour que la voiture roule bien au lieu d'attendre une panne. Les médecins de premier recours font des bilans réguliers pour détecter tôt les problèmes.",
            knowledges: [
              "<strong>Bilan de santé annuel :</strong> Examens physiques annuels pour dépister l'hypertension, le diabète et déceler les risques tôt.",
              "<strong>Prévention des maladies :</strong> Les médecins administrent les vaccins et vous conseillent sur l'alimentation et le sport.",
              "<strong>Orientation :</strong> Votre médecin traitant sert de pivot et vous oriente vers des spécialistes si un problème nécessite une attention particulière."
            ],
            skills: [
              "Trouver un médecin ou une clinique de quartier accessible en transports en commun.",
              "Vérifier si l'établissement propose des horaires après les cours ou en soirée.",
              "Rassembler et garder sur soi sa carte d'assurance, sa pièce d'identité et la liste de ses allergies.",
              "Préparer ses questions pour la prise de rendez-vous ('Examen physique annuel' vs 'Consultation d'urgence').",
              "Compétence essentielle : Appeler au moins 24 heures à l'avance pour annuler ou reporter si vous ne pouvez pas venir."
            ]
          },
          ht: {
            script: "Panse ak swen prensipal tankou antretyen regilye ou fè pou yon machin. Ou tcheke motè a, ou chanje lwil, ak wotasyon kawotchou pou machin nan ka mache byen olye ou tann motè a gate nèt. Doktè ak enfimyè fè chèk-up pou jwenn pwoblèm sante anvan yo vin grav.",
            knowledges: [
              "<strong>Chèk-up Regilye:</strong> Egzamen fizik anyèl pou verifye tansyon, dyabèt, ak jwenn pwoblèm yo byen bonè.",
              "<strong>Prevansyon Maladi:</strong> Doktè yo bay vaksen enpòtan epi ba ou konsèy sou bon manje ak fè egzèsis.",
              "<strong>Referans:</strong> Doktè prensipal ou a sèvi kòm baz ou, l ap ba ou referans pou wè espesyalis si yon pati nan kò w bezwen swen espesyal."
            ],
            skills: [
              "Jwenn yon doktè oswa klinik nan katye w ki fasil pou ale avèk otobis oswa tren.",
              "Verifye si klinik la louvri nan lè lekòl fin lage oswa nan aswè.",
              "Ranmase ak pote kat asirans sante w, pyès idantite w, ak lis alèji w yo.",
              "Prepare kesyon w yo pou w pran randevou ('Randevou fizik regilye' vs 'Vizit malad menm jou a').",
              "Ladrès Trè Enpòtan: Rele pou anile oswa chanje randevou a omwen 24 èdtan anvan si w pa kapab ale."
            ]
          }
        }
      },
      access: {
        id: "access",
        icon: "fa-hospital text-blue-600",
        badgeIcon: "🗺️",
        badgeName: "Healthcare Navigator",
        wordsToPronounce: {
          en: ["Healthcare System", "Specialist", "Outpatient Clinic", "Triage"],
          es: ["Sistema de salud", "Especialista", "Clínica ambulatoria", "Triaje"],
          pt: ["Sistema de saúde", "Especialista", "Clínica ambulatorial", "Triagem"],
          fr: ["Système de santé", "Spécialiste", "Clinique externe", "Triage"],
          ht: ["Sistèm Sante", "Espesyalik", "Klinik ekstèn", "Triyaj"]
        },
        content: {
          en: {
            script: "The U.S. healthcare system contains specialized entities. Knowing the difference between local clinics, dental providers, public health locations, and regional hospitals prevents expensive bills and gets you the fastest treatment.",
            knowledges: [
              "<strong>Primary Care Providers:</strong> Your main health home for vaccines, common wellness checks, and preventative care.",
              "<strong>Dental Providers:</strong> Keep teeth, gums, and oral structures clear of infections and chronic pain.",
              "<strong>Specialists:</strong> Specific doctors specializing in focused departments (e.g., Cardiologist for heart function)."
            ],
            skills: [
              "Identify the physical address of the nearest local outpatient community clinic.",
              "Practice navigating local transit maps to find outpatient clinics with direct bus access.",
              "Understand that visiting a general clinic is significantly less expensive than visiting emergency rooms."
            ]
          },
          es: {
            script: "El sistema de salud de EE. UU. contiene entidades especializadas. Conocer la diferencia entre clínicas locales, dentistas y hospitales previene facturas caras y te brinda el tratamiento más rápido.",
            knowledges: [
              "<strong>Médicos de Cabecera:</strong> Tu base para vacunas, chequeos generales de bienestar y prevención.",
              "<strong>Proveedores Dentales:</strong> Mantienen dientes, encías y boca libres de infecciones y dolor crónico.",
              "<strong>Especialistas:</strong> Médicos enfocados en áreas específicas (por ejemplo, cardiólogo para el corazón)."
            ],
            skills: [
              "Identifica la dirección física de la clínica comunitaria más cercana.",
              "Práctica el uso de mapas de autobús para llegar a las clínicas de atención primaria locales.",
              "Recuerda que visitar una clínica es mucho más barato que ir a una sala de emergencias (ER)."
            ]
          },
          pt: {
            script: "O sistema de saúde dos EUA possui entidades especializadas. Conhecer a diferença entre clínicas locais, dentistas e hospitais evita contas caras e garante o tratamento mais rápido.",
            knowledges: [
              "<strong>Médico de Família:</strong> Sua referência para vacinas, check-ups de rotina e cuidados preventivos.",
              "<strong>Dentistas:</strong> Mantêm seus dentes, gengivas e boca saudáveis, prevenindo infecções.",
              "<strong>Especialistas:</strong> Médicos especializados em uma área específica (ex: Cardiologista para o coração)."
            ],
            skills: [
              "Identifique o endereço físico da clínica comunitária mais próxima de sua casa.",
              "Pratique navegar por mapas de transporte público até as clínicas locais.",
              "Entenda que consultas em clínicas são muito mais baratas do que visitas ao pronto-socorro."
            ]
          },
          fr: {
            script: "Le système de santé américain comprend différents types d'établissements. Comprendre la différence entre cliniques locales, dentistes et hôpitaux vous évite des factures coûteuses et vous soigne plus vite.",
            knowledges: [
              "<strong>Médecin traitant :</strong> Votre point de contact principal pour les vaccins et bilans de santé.",
              "<strong>Soins dentaires :</strong> Pour garder vos dents et vos gencives saines et éviter les infections.",
              "<strong>Spécialistes :</strong> Médecins spécialisés dans un domaine précis (ex: un cardiologue pour le cœur)."
            ],
            skills: [
              "Trouver l'adresse de la clinique de santé communautaire la plus proche.",
              "Savoir utiliser les transports locaux pour s'y rendre de manière autonome.",
              "Comprendre qu'aller en clinique coûte beaucoup moins cher qu'aller aux urgences."
            ]
          },
          ht: {
            script: "Sistèm sante Ozetazini gen diferan kalite sèvis. Lè w konnen diferans ant klinik lokal yo, sèvis dantè, ak lopital, sa ap evite gwo bòdwo epi w ap jwenn swen pi rapid.",
            knowledges: [
              "<strong>Swen Prensipal:</strong> Premye kote pou vaksen, chèk-up jeneral, ak swen prevantif.",
              "<strong>Sèvis Dantè:</strong> Swen pou dan w, jansiv ou, ak bouch ou pou evite enfeksyon ak doulè.",
              "<strong>Espesyalik:</strong> Doktè espesyalize nan yon pati nan kò w (egzanp: Kadyològ pou kè w)."
            ],
            skills: [
              "Idantifye adrès fizik klinik kominote a ki pi pre w.",
              "Pratike kijan pou w pran otobis pou ale nan klinik ki pi pre w la.",
              "Konprann ke ale nan yon klinik koute mwens lajan pase ale nan ijans."
            ]
          }
        }
      },
      insurance: {
        id: "insurance",
        icon: "fa-address-card text-purple-600",
        badgeIcon: "💳",
        badgeName: "Insurance Specialist",
        wordsToPronounce: {
          en: ["Health Insurance", "Copay", "Medicaid", "Premium"],
          es: ["Seguro de salud", "Copago", "Medicaid", "Prima"],
          pt: ["Seguro de saúde", "Copagamento", "Medicaid", "Prêmio mensal"],
          fr: ["Assurance maladie", "Copaiement", "Medicaid", "Cotisation"],
          ht: ["Asirans Sante", "Kopèy (Copay)", "Medicaid", "Prim asirans"]
        },
        content: {
          en: {
            script: "In the United States, medical insurance covers expensive clinical bills. Understanding how to navigate coverage prevents surprise fees.",
            knowledges: [
              "<strong>Private Health Insurance:</strong> Offered through an employer or bought directly. Requires a monthly payment (premium).",
              "<strong>Public Insurance:</strong> Provided by governments for financial assistance, disabilities, or specific ages (e.g., Medicaid / Medicare).",
              "<strong>Copay:</strong> A small fixed fee you pay on the spot at each clinic visit (e.g., $15 or $25)."
            ],
            skills: [
              "Locate and make a clear copy of the front and back of your health insurance card.",
              "Notify your health insurance provider whenever you change your residential address.",
              "Double-check your plan limits for primary preventative check-ups (often free or low copay) vs emergency room treatment."
            ]
          },
          es: {
            script: "En los Estados Unidos, el seguro médico ayuda a pagar las costosas facturas clínicas. Entender cómo navegar tu cobertura previene cobros inesperados.",
            knowledges: [
              "<strong>Seguro Privado:</strong> Se obtiene por un trabajo o plan familiar. Requiere un pago mensual llamado prima.",
              "<strong>Seguro Público:</strong> Del gobierno para personas con necesidades financieras, discapacidades o edades específicas (ej. Medicaid/Medicare).",
              "<strong>Copago:</strong> Una pequeña tarifa fija que pagas en la oficina del doctor al momento de tu consulta (ej. $15 o $25)."
            ],
            skills: [
              "Saca una fotocopia clara del frente y reverso de tu tarjeta de seguro de salud.",
              "Notifica a tu aseguradora de salud si cambias de dirección de casa.",
              "Confirma que los chequeos preventivos anuales son gratuitos con tu seguro."
            ]
          },
          pt: {
            script: "Nos Estados Unidos, o seguro de saúde cobre despesas médicas caras. Compreender a sua cobertura evita cobranças surpresa.",
            knowledges: [
              "<strong>Seguro de Saúde Privado:</strong> Geralmente oferecido pelo trabalho ou plano dos pais. Requer pagamento mensal (prêmio).",
              "<strong>Seguro Público:</strong> Fornecido pelo governo baseado em renda, deficiência ou idade (ex: Medicaid e Medicare).",
              "<strong>Copagamento (Copay):</strong> Uma taxa fixa paga no momento da consulta médica (ex: $15 ou $25)."
            ],
            skills: [
              "Tire uma cópia nítida da frente e do verso do seu cartão do seguro de saúde.",
              "Avise o seu plano de saúde sempre que mudar de endereço residencial.",
              "Verifique se o check-up preventivo anual é totalmente coberto pelo seu plano."
            ]
          },
          fr: {
            script: "Aux États-Unis, l'assurance maladie couvre les factures médicales élevées. Comprendre votre couverture vous évite des frais imprévus.",
            knowledges: [
              "<strong>Assurance Privée :</strong> Obtenue via l'employeur ou un parent. Nécessite une cotisation mensuelle (prime).",
              "<strong>Assurance Publique :</strong> Financée par le gouvernement selon les revenus, le handicap ou l'âge (ex: Medicaid, Medicare).",
              "<strong>Copay (Copaiement) :</strong> Un petit montant fixe à payer lors de chaque visite médicale (ex : 15$ ou 25$)."
            ],
            skills: [
              "Faire une copie claire du recto et du verso de votre carte d'assurance maladie.",
              "Informer votre assureur en cas de changement d'adresse résidentielle.",
              "Vérifier la différence de coût entre une visite préventive (souvent gratuite) et un passage aux urgences."
            ]
          },
          ht: {
            script: "Ozetazini, asirans sante ede w peye gwo bòdwo lopital. Lè w konprann kijan asirans la mache, sa ap ede w evite gwo frè sipriz.",
            knowledges: [
              "<strong>Asirans Sante Privé:</strong> Ou jwenn li nan travay oswa sou plan paran w. Li mande pou w peye yon prim chak mwa.",
              "<strong>Asirans Sante Piblik:</strong> Gouvènman an bay li pou moun ki gen ti revni, andikap, oswa laj (egzanp: Medicaid ak Medicare).",
              "<strong>Kopèy (Copay):</strong> Yon ti kòb fiks ou peye lè w rive nan klinik la pou wè doktè a (egzanp: $15 oswa $25)."
            ],
            skills: [
              "Fè yon kopi klè sou devan ak dèyè kat asirans sante w la.",
              "Notifye konpayi asirans ou an chak fwa ou chanje adrès kote w rete a.",
              "Tcheke diferans ki genyen ant pri pou swen prevantif (souvan gratis) ak ale nan ijans."
            ]
          }
        }
      },
      rights: {
        id: "rights",
        icon: "fa-scale-balanced text-indigo-600",
        badgeIcon: "⚖️",
        badgeName: "Rights Advocate",
        wordsToPronounce: {
          en: ["Confidentiality", "Self-Advocacy", "Patient Rights", "Informed Consent"],
          es: ["Confidencialidad", "Defensa propia", "Derechos del paciente", "Consentimiento informado"],
          pt: ["Confidencialidade", "Auto-advocacia", "Direitos do paciente", "Consentimento informado"],
          fr: ["Confidentialité", "Défense de soi", "Droits des patients", "Consentement éclairé"],
          ht: ["Konfidansyalite", "Defans Tèt Ou", "Dwa Pasyan", "Konsantman konesans"]
        },
        content: {
          en: {
            script: "You hold protected medical and legal rights to keep your treatment information strictly confidential. Healthcare personnel cannot release details without informed consent.",
            knowledges: [
              "<strong>Patient Rights:</strong> Receive clear details about your specific medical diagnosis and safe treatments.",
              "<strong>Privacy:</strong> HIPAA guarantees that details cannot be shared with unauthorized groups without your signature.",
              "<strong>Informed Consent:</strong> You have the right to approve or refuse any medical test or medication."
            ],
            skills: [
              "Ask clear questions directly if you do not understand a medical term or procedure.",
              "Exercise self-advocacy by asking for translation interpreters at any doctor's clinic.",
              "Request physical or digital copies of your official immunization and clinical health records."
            ]
          },
          es: {
            script: "Tienes derechos médicos y legales protegidos para mantener la información de tu tratamiento en estricta confidencialidad.",
            knowledges: [
              "<strong>Derechos del Paciente:</strong> Recibir detalles claros sobre tu diagnóstico médico y opciones de tratamiento.",
              "<strong>Privacidad:</strong> Las leyes garantizan que tus datos no se compartirán sin tu firma de autorización.",
              "<strong>Consentimiento Informado:</strong> Tienes derecho a aprobar o rechazar pruebas o medicamentos."
            ],
            skills: [
              "Haz preguntas directas si no comprendes un término médico o procedimiento.",
              "Aboga por ti mismo solicitando un intérprete gratuito en cualquier clínica u hospital.",
              "Solicita copias físicas o electrónicas de tus registros médicos e inmunizaciones."
            ]
          },
          pt: {
            script: "Você tem direitos médicos e legais protegidos para manter suas informações de saúde confidenciais.",
            knowledges: [
              "<strong>Direitos do Paciente:</strong> Receber informações claras sobre o seu diagnóstico e opções de tratamentos.",
              "<strong>Privacidade:</strong> Suas informações de saúde são confidenciais e protegidas por lei, não podendo ser reveladas sem autorização.",
              "<strong>Consentimento Informado:</strong> Você tem o direito de aceitar ou recusar qualquer tratamento ou exame."
            ],
            skills: [
              "Faça perguntas diretas se não entender um termo médico ou procedimento.",
              "Pratique a auto-advocacia pedindo um intérprete de idiomas gratuito em qualquer consulta.",
              "Solicite uma cópia impressa ou digital dos seus registros de vacinação e histórico médico."
            ]
          },
          fr: {
            script: "Vous disposez de droits médicaux et légaux protégés garantissant la confidentialité absolue de vos soins.",
            knowledges: [
              "<strong>Droits des patients :</strong> Recevoir des informations claires sur votre diagnostic et vos traitements.",
              "<strong>Confidentialité :</strong> Vos données de santé ne peuvent pas être transmises sans votre consentement écrit.",
              "<strong>Consentement éclairé :</strong> Vous êtes libre d'accepter ou de refuser un traitement ou un examen."
            ],
            skills: [
              "Poser des questions au médecin si vous ne comprenez pas un terme ou un traitement.",
              "Demander la mise à disposition d'un interprète gratuit si nécessaire lors de votre visite.",
              "Demander des copies de votre dossier d'immunisation et de vos examens."
            ]
          },
          ht: {
            script: "Ou gen dwa medikal ak legal pou kenbe enfòmasyon sou lasante w yo konfidansyèl nèt. Travayè lasante pa ka bay lòt moun enfòmasyon sa yo san konsantman w.",
            knowledges: [
              "<strong>Dwa Pasyan:</strong> Resevwa detay klè sou dyagnostik ou ak chwa tretman ou yo.",
              "<strong>Konfidansyalite:</strong> Lalwa pwoteje enfòmasyon medikal ou yo pou yo pa pataje yo san siyati w.",
              "<strong>Konsantman:</strong> Ou gen dwa pou w aksepte oswa refize nenpòt tès medikal oswa medikaman."
            ],
            skills: [
              "Poze kesyon dirèkteman si w pa konprann yon mo medikal oswa yon tès y ap fè w.",
              "Defann tèt ou lè w mande pou yo ba w yon tradiktè gratis nan nenpòt klinik oswa lopital.",
              "Mande kopi fizik oswa dijital de dosye vaksen w yo ak dosye medikal ou yo."
            ]
          }
        }
      },
      school: {
        id: "school",
        icon: "fa-shield-halved text-teal-600",
        badgeIcon: "💉",
        badgeName: "Immunization Savvy",
        wordsToPronounce: {
          en: ["Immunization", "Vaccination", "Polio", "Varicella"],
          es: ["Inmunización", "Vacunación", "Polio", "Varicela"],
          pt: ["Imunização", "Vacinação", "Pólio", "Varicela"],
          fr: ["Immunisation", "Vaccination", "Polio", "Varicelle"],
          ht: ["Iminizasyon", "Vaksen", "Polyo", "Varisèl"]
        },
        content: {
          en: {
            script: "To enroll in Massachusetts schools, State Law requires proof of up-to-date immunizations. Vaccines train your body to fight contagious infections before you fall sick.",
            knowledges: [
              "<strong>First Vaccine:</strong> Developed in 1796 by Edward Jenner to protect the global population.",
              "<strong>State Requirements:</strong> Requires certified proof of DTaP/Tdap, Polio, Hepatitis B, MMR (Measles, Mumps, Rubella), and Varicella (chickenpox) shots.",
              "<strong>Infection Prevention:</strong> Immunizations protect both your health and prevent spreading severe viruses on campus."
            ],
            skills: [
              "Obtain an official copy of your yellow or digital immunization record from your provider.",
              "Schedule clinic updates for missed vaccine boosters (like the adolescent Tdap booster).",
              "Submit proof directly to your School Nurse to guarantee educational compliance."
            ]
          },
          es: {
            script: "Para inscribirte en las escuelas de Massachusetts, la ley exige comprobantes de inmunizaciones al día. Las vacunas enseñan al cuerpo a combatir infecciones.",
            knowledges: [
              "<strong>Primera vacuna:</strong> Creada en 1796 por Edward Jenner para proteger a la población mundial.",
              "<strong>Requisitos Estatales:</strong> Requiere pruebas de DTaP/Tdap, Polio, Hepatitis B, MMR y Varicela.",
              "<strong>Prevención:</strong> Protegen tu salud y la de toda la comunidad escolar al evitar contagios."
            ],
            skills: [
              "Consigue una copia oficial de tu cartilla de vacunación (digital o en papel amarillo).",
              "Programa citas para ponerte al día con vacunas faltantes (como el refuerzo Tdap de adolescentes).",
              "Entrega los comprobantes directamente a tu enfermera escolar."
            ]
          },
          pt: {
            script: "Para se matricular nas escolas de Massachusetts, a lei exige comprovante de vacinação em dia. As vacinas ensinam o seu corpo a combater infecções.",
            knowledges: [
              "<strong>Primeira Vacina:</strong> Desenvolvida em 1796 por Edward Jenner, salvando milhões de vidas.",
              "<strong>Exigências do Estado:</strong> Exige comprovantes de DTaP/Tdap, Pólio, Hepatite B, MMR e Varicela.",
              "<strong>Proteção Escolar:</strong> As vacinas impedem que vírus perigosos se espalhem na escola."
            ],
            skills: [
              "Obtenha uma cópia oficial do seu registro ou carteira de vacinação amarela.",
              "Agende atualizações de vacinas que possam estar atrasadas (como o reforço Tdap).",
              "Envie o comprovante de vacinação diretamente para a enfermaria da escola."
            ]
          },
          fr: {
            script: "Pour s'inscrire à l'école dans le Massachusetts, la loi exige un carnet de vaccination à jour. Les vaccins entraînent votre corps à lutter contre les maladies.",
            knowledges: [
              "<strong>Découverte historique :</strong> Le premier vaccin a été mis au point en 1796 par Edward Jenner.",
              "<strong>Obligations scolaires :</strong> Preuves requises pour le DTP, la Polio, l'Hépatite B, le ROR (Rougeole-Oreillons-Rubéole) et la Varicelle.",
              "<strong>Protection collective :</strong> Les vaccins protègent votre santé et évitent la propagation de virus à l'école."
            ],
            skills: [
              "Obtenir une copie officielle de votre historique de vaccination.",
              "Prendre rendez-vous en clinique pour les rappels de vaccins nécessaires.",
              "Transmettre directement le document à l'infirmerie de l'école pour valider votre dossier."
            ]
          },
          ht: {
            script: "Pou w enskri nan lekòl nan leta Massachusetts, lalwa mande pou w bay prèv vaksen w yo ajou. Vaksen yo aprann kò w goumen ak enfeksyon anvan w malad.",
            knowledges: [
              "<strong>Premye Vaksen:</strong> Se Edward Jenner ki te devlope l nan ane 1796 pou pwoteje moun nan lemonn.",
              "<strong>Kondisyon Lekòl la:</strong> Leta mande pou bay prèv pou vaksen DTaP/Tdap, Polyo, Epatit B, MMR, ak Varisèl.",
              "<strong>Prevansyon Enfeksyon:</strong> Vaksen yo pwoteje pwòp sante w epi yo anpeche gwo viris gaye nan lekòl la."
            ],
            skills: [
              "Jwenn yon kopi ofisyèl nan dosye vaksen jòn ou an oswa vèsyon dijital.",
              "Pran randevou nan yon klinik pou pran dòz rapèl ki manke yo (tankou rapèl Tdap la).",
              "Bay prèv la dirèkteman bay Enfimyè Lekòl la pou w ka an règle."
            ]
          }
        }
      },
      emergency: {
        id: "emergency",
        icon: "fa-truck-medical text-rose-600",
        badgeIcon: "🚨",
        badgeName: "Preparedness Expert",
        wordsToPronounce: {
          en: ["Emergency Room", "Urgent Care", "Minor Illness", "Accident"],
          es: ["Sala de emergencias", "Cuidado urgente", "Enfermedad menor", "Accidente"],
          pt: ["Pronto-socorro", "Pronto atendimento", "Doença leve", "Acidente grave"],
          fr: ["Urgences", "Soins continus", "Maladie mineure", "Accident grave"],
          ht: ["Ijans (Emergency)", "Swen Ijan (Urgent Care)", "Ti Maladi", "Aksidan"]
        },
        content: {
          en: {
            script: "Knowing where to go for minor sickness vs serious life-threatening events can save your life and prevent thousands of dollars in surprise hospital bills.",
            knowledges: [
              "<strong>Urgent Care:</strong> Go here for minor cuts, sprains, cold symptoms, minor rashes, or small burns. These open fast without appointments.",
              "<strong>Emergency Room (ER):</strong> Go here ONLY for major emergencies: heavy bleeding, chest pain, broken bones, or breathing failure.",
              "<strong>Cost Difference:</strong> ER visits can cost over $1,000, while Urgent Care is usually a small flat copay."
            ],
            skills: [
              "Identify and locate the closest Urgent Care clinic in your immediate zip code area.",
              "Save the local emergency number (911) and the phone numbers of your local primary clinic.",
              "Memorize the key difference: go to Urgent Care for non-emergencies; go to the ER or call 911 for life-threatening issues."
            ]
          },
          es: {
            script: "Saber a dónde ir para enfermedades menores en comparación con eventos graves puede salvar tu vida y evitar facturas sorpresa muy altas.",
            knowledges: [
              "<strong>Cuidado Urgente:</strong> Ve aquí por cortadas menores, esguinces, síntomas de resfriado, o quemaduras pequeñas.",
              "<strong>Sala de Emergencias (ER):</strong> Ve aquí SOLO para emergencias mayores: sangrado grave, dolor de pecho, huesos rotos, o dificultad para respirar.",
              "<strong>Diferencia de Costo:</strong> Las visitas a ER pueden costar miles de dólares; el cuidado urgente suele tener un copago bajo."
            ],
            skills: [
              "Identifica y ubica la clínica de Cuidado Urgente (Urgent Care) más cercana a tu código postal.",
              "Guarda los números de emergencia (911) y los de tu clínica de cabecera en tu teléfono.",
              "Recuerda la regla de oro: Cuidado urgente para lo leve; Sala de emergencias (ER) para salvar la vida."
            ]
          },
          pt: {
            script: "Saber para onde ir em caso de doença leve em comparação com emergências graves pode salvar vidas e evitar contas hospitalares astronômicas.",
            knowledges: [
              "<strong>Pronto Atendimento (Urgent Care):</strong> Vá aqui para pequenos cortes, entorses, resfriados, alergias leves ou queimaduras pequenas. Atendimento rápido e sem agendamento.",
              "<strong>Pronto-Socorro (ER):</strong> Vá aqui APENAS para grandes emergências: sangramento intenso, dor no peito, fraturas expostas ou falta de ar grave.",
              "<strong>Diferença de Custo:</strong> Ir ao pronto-socorro pode custar mais de $1.000, enquanto o Pronto Atendimento costuma ser uma taxa de copagamento baixa."
            ],
            skills: [
              "Identifique e anote o endereço do Pronto Atendimento mais próximo do seu CEP.",
              "Salve o número de emergência nacional (911) e o número da sua clínica principal no telefone.",
              "Lembre-se: use o Pronto Atendimento para casos leves e o Pronto-Socorro para risco de vida."
            ]
          },
          fr: {
            script: "Savoir faire la différence entre une maladie légère et une urgence vitale peut sauver des vies et vous éviter des dépenses médicales massives.",
            knowledges: [
              "<strong>Soins continus (Urgent Care) :</strong> Pour les petites coupures, entorses, symptômes de rhume ou brûlures légères. Rapide et sans rendez-vous.",
              "<strong>Urgences (ER) :</strong> À réserver UNIQUEMENT aux cas graves : saignements majeurs, douleurs thoraciques, fractures, difficultés respiratoires.",
              "<strong>Coût :</strong> Un passage aux urgences peut coûter plus de 1 000 $, contre un tarif fixe très bas en cabinet de soins continus."
            ],
            skills: [
              "Trouver l'adresse du centre de soins continus (Urgent Care) le plus proche de votre code postal.",
              "Enregistrer le numéro d'urgence (911) et celui de votre médecin traitant.",
              "Retenir la règle : Soins continus pour les petits maux ; Urgences pour les cas critiques."
            ]
          },
          ht: {
            script: "Lè w konnen ki kote pou w ale pou ti maladi kontrèman ak gwo ijans, sa ka sove lavi w epi evite gwo bòdwo lopital.",
            knowledges: [
              "<strong>Swen Ijan (Urgent Care):</strong> Ale la pou ti koupe, tòde ponyèt, rim, ti gratèl, oswa ti boule. Yo louvri vit san randevou.",
              "<strong>Sann Ijans (ER):</strong> Ale la SEULMAN pou gwo ijans: gwo senyen, doulè nan lestonmak, zo kase, oswa pwoblèm pou respire.",
              "<strong>Diferans Pri:</strong> Ale nan ER ka koute plis pase $1,000, alòske Urgent Care anjeneral koute yon ti kopèy fiks."
            ],
            skills: [
              "Idantifye epi jwenn adrès klinik Urgent Care ki pi pre kòd postal kote w rete a.",
              "Sove nimewo ijans lan (911) ak nimewo telefòn klinik prensipal ou a nan telefòn ou.",
              "Chonje diferans sa a: ale nan Urgent Care pou pwoblèm ki pa grav; ale nan ER pou pwoblèm ki ka pran lavi w."
            ]
          }
        }
      }
    };
