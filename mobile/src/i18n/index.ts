// Mobile-specific i18n setup
// Import shared i18n first
import i18n from '@/i18n'

// Add mobile-specific translations for all 18 supported languages
const mobileTranslations = {
  en: {
    playground: {
      input: 'Input',
      capture: {
        removeFile: 'Remove File',
        removeFileConfirm: 'Are you sure you want to remove this file?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Save as Template',
        dialogTitle: 'Save as Template',
        nameLabel: 'Template Name',
        namePlaceholder: 'Enter template name',
        success: 'Template Saved',
        successDesc: 'The template has been saved successfully.',
        error: 'Save Failed',
        noInputsTitle: 'Cannot Save Template',
        noInputsDesc: 'Input parameters are not available for this history record.',
        duplicateName: 'A template with this name already exists. Please choose a different name.'
      }
    },
    videoConverter: {
      title: 'Video Converter',
      description: 'Convert videos between formats using your browser',
      invalidFile: 'Please select a valid video file',
      input: 'Input Video',
      inputDesc: 'Select or drag a video file to convert',
      dropzone: 'Click or drag video here',
      supportedFormats: 'Supports MP4, WebM, MOV, AVI',
      settings: 'Settings',
      outputFormat: 'Output Format',
      convert: 'Convert Video',
      converting: 'Converting...',
      noCodecSupport: 'No supported video codec found',
      result: 'Result',
      codecUsed: 'Codec used',
      download: 'Download'
    }
  },
  'zh-CN': {
    playground: {
      input: '输入',
      capture: {
        removeFile: '移除文件',
        removeFileConfirm: '确定要移除这个文件吗？'
      }
    },
    history: {
      saveTemplate: {
        button: '保存为模板',
        dialogTitle: '保存为模板',
        nameLabel: '模板名称',
        namePlaceholder: '输入模板名称',
        success: '模板已保存',
        successDesc: '模板保存成功。',
        error: '保存失败',
        noInputsTitle: '无法保存模板',
        noInputsDesc: '此历史记录的输入参数不可用。',
        duplicateName: '已存在同名模板，请使用其他名称。'
      }
    },
    videoConverter: {
      title: '视频转换器',
      description: '在浏览器中转换视频格式',
      invalidFile: '请选择有效的视频文件',
      input: '输入视频',
      inputDesc: '选择或拖拽视频文件进行转换',
      dropzone: '点击或拖拽视频到此处',
      supportedFormats: '支持 MP4, WebM, MOV, AVI',
      settings: '设置',
      outputFormat: '输出格式',
      convert: '转换视频',
      converting: '转换中...',
      noCodecSupport: '未找到支持的视频编码器',
      result: '结果',
      codecUsed: '使用的编码器',
      download: '下载'
    }
  },
  'zh-TW': {
    playground: {
      input: '輸入',
      capture: {
        removeFile: '移除檔案',
        removeFileConfirm: '確定要移除這個檔案嗎？'
      }
    },
    history: {
      saveTemplate: {
        button: '儲存為模板',
        dialogTitle: '儲存為模板',
        nameLabel: '模板名稱',
        namePlaceholder: '輸入模板名稱',
        success: '模板已儲存',
        successDesc: '模板儲存成功。',
        error: '儲存失敗',
        noInputsTitle: '無法儲存模板',
        noInputsDesc: '此歷史記錄的輸入參數不可用。',
        duplicateName: '已存在同名模板，請使用其他名稱。'
      }
    },
    videoConverter: {
      title: '影片轉換器',
      description: '在瀏覽器中轉換影片格式',
      invalidFile: '請選擇有效的影片檔案',
      input: '輸入影片',
      inputDesc: '選擇或拖曳影片檔案進行轉換',
      dropzone: '點擊或拖曳影片到此處',
      supportedFormats: '支援 MP4, WebM, MOV, AVI',
      settings: '設定',
      outputFormat: '輸出格式',
      convert: '轉換影片',
      converting: '轉換中...',
      noCodecSupport: '未找到支援的影片編碼器',
      result: '結果',
      codecUsed: '使用的編碼器',
      download: '下載'
    }
  },
  ja: {
    playground: {
      input: '入力',
      capture: {
        removeFile: 'ファイルを削除',
        removeFileConfirm: 'このファイルを削除してもよろしいですか？'
      }
    },
    history: {
      saveTemplate: {
        button: 'テンプレートとして保存',
        dialogTitle: 'テンプレートとして保存',
        nameLabel: 'テンプレート名',
        namePlaceholder: 'テンプレート名を入力',
        success: 'テンプレートを保存しました',
        successDesc: 'テンプレートが正常に保存されました。',
        error: '保存に失敗しました',
        noInputsTitle: 'テンプレートを保存できません',
        noInputsDesc: 'この履歴の入力パラメータは利用できません。',
        duplicateName: '同じ名前のテンプレートが既に存在します。別の名前を選んでください。'
      }
    },
    videoConverter: {
      title: '動画コンバーター',
      description: 'ブラウザで動画形式を変換',
      invalidFile: '有効な動画ファイルを選択してください',
      input: '入力動画',
      inputDesc: '変換する動画ファイルを選択またはドラッグ',
      dropzone: 'クリックまたは動画をここにドラッグ',
      supportedFormats: 'MP4, WebM, MOV, AVI対応',
      settings: '設定',
      outputFormat: '出力形式',
      convert: '動画を変換',
      converting: '変換中...',
      noCodecSupport: 'サポートされているコーデックが見つかりません',
      result: '結果',
      codecUsed: '使用コーデック',
      download: 'ダウンロード'
    }
  },
  ko: {
    playground: {
      input: '입력',
      capture: {
        removeFile: '파일 제거',
        removeFileConfirm: '이 파일을 제거하시겠습니까?'
      }
    },
    history: {
      saveTemplate: {
        button: '템플릿으로 저장',
        dialogTitle: '템플릿으로 저장',
        nameLabel: '템플릿 이름',
        namePlaceholder: '템플릿 이름 입력',
        success: '템플릿 저장됨',
        successDesc: '템플릿이 성공적으로 저장되었습니다.',
        error: '저장 실패',
        noInputsTitle: '템플릿을 저장할 수 없습니다',
        noInputsDesc: '이 기록의 입력 매개변수를 사용할 수 없습니다.',
        duplicateName: '같은 이름의 템플릿이 이미 존재합니다. 다른 이름을 선택해 주세요.'
      }
    },
    videoConverter: {
      title: '비디오 변환기',
      description: '브라우저에서 비디오 형식 변환',
      invalidFile: '유효한 비디오 파일을 선택하세요',
      input: '입력 비디오',
      inputDesc: '변환할 비디오 파일을 선택하거나 드래그하세요',
      dropzone: '클릭하거나 비디오를 여기에 드래그',
      supportedFormats: 'MP4, WebM, MOV, AVI 지원',
      settings: '설정',
      outputFormat: '출력 형식',
      convert: '비디오 변환',
      converting: '변환 중...',
      noCodecSupport: '지원되는 비디오 코덱을 찾을 수 없습니다',
      result: '결과',
      codecUsed: '사용된 코덱',
      download: '다운로드'
    }
  },
  es: {
    playground: {
      input: 'Entrada',
      capture: {
        removeFile: 'Eliminar archivo',
        removeFileConfirm: '¿Está seguro de que desea eliminar este archivo?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Guardar como plantilla',
        dialogTitle: 'Guardar como plantilla',
        nameLabel: 'Nombre de la plantilla',
        namePlaceholder: 'Ingrese el nombre de la plantilla',
        success: 'Plantilla guardada',
        successDesc: 'La plantilla se ha guardado correctamente.',
        error: 'Error al guardar',
        noInputsTitle: 'No se puede guardar la plantilla',
        noInputsDesc: 'Los parámetros de entrada no están disponibles para este registro del historial.',
        duplicateName: 'Ya existe una plantilla con este nombre. Por favor, elija un nombre diferente.'
      }
    },
    videoConverter: {
      title: 'Convertidor de Video',
      description: 'Convierte videos entre formatos usando tu navegador',
      invalidFile: 'Por favor selecciona un archivo de video válido',
      input: 'Video de Entrada',
      inputDesc: 'Selecciona o arrastra un archivo de video para convertir',
      dropzone: 'Haz clic o arrastra el video aquí',
      supportedFormats: 'Soporta MP4, WebM, MOV, AVI',
      settings: 'Configuración',
      outputFormat: 'Formato de Salida',
      convert: 'Convertir Video',
      converting: 'Convirtiendo...',
      noCodecSupport: 'No se encontró un códec de video compatible',
      result: 'Resultado',
      codecUsed: 'Códec utilizado',
      download: 'Descargar'
    }
  },
  fr: {
    playground: {
      input: 'Entrée',
      capture: {
        removeFile: 'Supprimer le fichier',
        removeFileConfirm: 'Êtes-vous sûr de vouloir supprimer ce fichier ?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Enregistrer comme modèle',
        dialogTitle: 'Enregistrer comme modèle',
        nameLabel: 'Nom du modèle',
        namePlaceholder: 'Entrez le nom du modèle',
        success: 'Modèle enregistré',
        successDesc: 'Le modèle a été enregistré avec succès.',
        error: 'Échec de l\'enregistrement',
        noInputsTitle: 'Impossible d\'enregistrer le modèle',
        noInputsDesc: 'Les paramètres d\'entrée ne sont pas disponibles pour cet enregistrement d\'historique.',
        duplicateName: 'Un modèle avec ce nom existe déjà. Veuillez choisir un nom différent.'
      }
    },
    videoConverter: {
      title: 'Convertisseur Vidéo',
      description: 'Convertir des vidéos entre formats avec votre navigateur',
      invalidFile: 'Veuillez sélectionner un fichier vidéo valide',
      input: 'Vidéo d\'Entrée',
      inputDesc: 'Sélectionnez ou glissez un fichier vidéo à convertir',
      dropzone: 'Cliquez ou glissez la vidéo ici',
      supportedFormats: 'Supporte MP4, WebM, MOV, AVI',
      settings: 'Paramètres',
      outputFormat: 'Format de Sortie',
      convert: 'Convertir la Vidéo',
      converting: 'Conversion en cours...',
      noCodecSupport: 'Aucun codec vidéo supporté trouvé',
      result: 'Résultat',
      codecUsed: 'Codec utilisé',
      download: 'Télécharger'
    }
  },
  de: {
    playground: {
      input: 'Eingabe',
      capture: {
        removeFile: 'Datei entfernen',
        removeFileConfirm: 'Sind Sie sicher, dass Sie diese Datei entfernen möchten?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Als Vorlage speichern',
        dialogTitle: 'Als Vorlage speichern',
        nameLabel: 'Vorlagenname',
        namePlaceholder: 'Vorlagenname eingeben',
        success: 'Vorlage gespeichert',
        successDesc: 'Die Vorlage wurde erfolgreich gespeichert.',
        error: 'Speichern fehlgeschlagen',
        noInputsTitle: 'Vorlage kann nicht gespeichert werden',
        noInputsDesc: 'Eingabeparameter sind für diesen Verlaufseintrag nicht verfügbar.',
        duplicateName: 'Eine Vorlage mit diesem Namen existiert bereits. Bitte wählen Sie einen anderen Namen.'
      }
    },
    videoConverter: {
      title: 'Video-Konverter',
      description: 'Videos zwischen Formaten mit Ihrem Browser konvertieren',
      invalidFile: 'Bitte wählen Sie eine gültige Videodatei',
      input: 'Eingabevideo',
      inputDesc: 'Wählen oder ziehen Sie eine Videodatei zum Konvertieren',
      dropzone: 'Klicken oder Video hierher ziehen',
      supportedFormats: 'Unterstützt MP4, WebM, MOV, AVI',
      settings: 'Einstellungen',
      outputFormat: 'Ausgabeformat',
      convert: 'Video konvertieren',
      converting: 'Konvertierung...',
      noCodecSupport: 'Kein unterstützter Video-Codec gefunden',
      result: 'Ergebnis',
      codecUsed: 'Verwendeter Codec',
      download: 'Herunterladen'
    }
  },
  it: {
    playground: {
      input: 'Input',
      capture: {
        removeFile: 'Rimuovi file',
        removeFileConfirm: 'Sei sicuro di voler rimuovere questo file?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Salva come modello',
        dialogTitle: 'Salva come modello',
        nameLabel: 'Nome del modello',
        namePlaceholder: 'Inserisci il nome del modello',
        success: 'Modello salvato',
        successDesc: 'Il modello è stato salvato con successo.',
        error: 'Salvataggio fallito',
        noInputsTitle: 'Impossibile salvare il modello',
        noInputsDesc: 'I parametri di input non sono disponibili per questo record della cronologia.',
        duplicateName: 'Esiste già un modello con questo nome. Scegli un nome diverso.'
      }
    },
    videoConverter: {
      title: 'Convertitore Video',
      description: 'Converti video tra formati usando il tuo browser',
      invalidFile: 'Seleziona un file video valido',
      input: 'Video di Input',
      inputDesc: 'Seleziona o trascina un file video da convertire',
      dropzone: 'Clicca o trascina il video qui',
      supportedFormats: 'Supporta MP4, WebM, MOV, AVI',
      settings: 'Impostazioni',
      outputFormat: 'Formato di Output',
      convert: 'Converti Video',
      converting: 'Conversione...',
      noCodecSupport: 'Nessun codec video supportato trovato',
      result: 'Risultato',
      codecUsed: 'Codec utilizzato',
      download: 'Scarica'
    }
  },
  pt: {
    playground: {
      input: 'Entrada',
      capture: {
        removeFile: 'Remover arquivo',
        removeFileConfirm: 'Tem certeza de que deseja remover este arquivo?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Salvar como modelo',
        dialogTitle: 'Salvar como modelo',
        nameLabel: 'Nome do modelo',
        namePlaceholder: 'Digite o nome do modelo',
        success: 'Modelo salvo',
        successDesc: 'O modelo foi salvo com sucesso.',
        error: 'Falha ao salvar',
        noInputsTitle: 'Não é possível salvar o modelo',
        noInputsDesc: 'Os parâmetros de entrada não estão disponíveis para este registro do histórico.',
        duplicateName: 'Já existe um modelo com este nome. Por favor, escolha um nome diferente.'
      }
    },
    videoConverter: {
      title: 'Conversor de Vídeo',
      description: 'Converta vídeos entre formatos usando seu navegador',
      invalidFile: 'Por favor selecione um arquivo de vídeo válido',
      input: 'Vídeo de Entrada',
      inputDesc: 'Selecione ou arraste um arquivo de vídeo para converter',
      dropzone: 'Clique ou arraste o vídeo aqui',
      supportedFormats: 'Suporta MP4, WebM, MOV, AVI',
      settings: 'Configurações',
      outputFormat: 'Formato de Saída',
      convert: 'Converter Vídeo',
      converting: 'Convertendo...',
      noCodecSupport: 'Nenhum codec de vídeo suportado encontrado',
      result: 'Resultado',
      codecUsed: 'Codec utilizado',
      download: 'Baixar'
    }
  },
  ru: {
    playground: {
      input: 'Ввод',
      capture: {
        removeFile: 'Удалить файл',
        removeFileConfirm: 'Вы уверены, что хотите удалить этот файл?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Сохранить как шаблон',
        dialogTitle: 'Сохранить как шаблон',
        nameLabel: 'Название шаблона',
        namePlaceholder: 'Введите название шаблона',
        success: 'Шаблон сохранён',
        successDesc: 'Шаблон успешно сохранён.',
        error: 'Ошибка сохранения',
        noInputsTitle: 'Невозможно сохранить шаблон',
        noInputsDesc: 'Входные параметры недоступны для этой записи истории.',
        duplicateName: 'Шаблон с таким именем уже существует. Пожалуйста, выберите другое имя.'
      }
    },
    videoConverter: {
      title: 'Конвертер Видео',
      description: 'Конвертируйте видео между форматами в браузере',
      invalidFile: 'Пожалуйста, выберите корректный видеофайл',
      input: 'Входное Видео',
      inputDesc: 'Выберите или перетащите видеофайл для конвертации',
      dropzone: 'Нажмите или перетащите видео сюда',
      supportedFormats: 'Поддерживает MP4, WebM, MOV, AVI',
      settings: 'Настройки',
      outputFormat: 'Выходной Формат',
      convert: 'Конвертировать Видео',
      converting: 'Конвертация...',
      noCodecSupport: 'Поддерживаемый видеокодек не найден',
      result: 'Результат',
      codecUsed: 'Использованный кодек',
      download: 'Скачать'
    }
  },
  ar: {
    playground: {
      input: 'إدخال',
      capture: {
        removeFile: 'إزالة الملف',
        removeFileConfirm: 'هل أنت متأكد أنك تريد إزالة هذا الملف؟'
      }
    },
    history: {
      saveTemplate: {
        button: 'حفظ كقالب',
        dialogTitle: 'حفظ كقالب',
        nameLabel: 'اسم القالب',
        namePlaceholder: 'أدخل اسم القالب',
        success: 'تم حفظ القالب',
        successDesc: 'تم حفظ القالب بنجاح.',
        error: 'فشل الحفظ',
        noInputsTitle: 'لا يمكن حفظ القالب',
        noInputsDesc: 'معلمات الإدخال غير متوفرة لسجل السجل هذا.',
        duplicateName: 'يوجد قالب بهذا الاسم بالفعل. يرجى اختيار اسم مختلف.'
      }
    },
    videoConverter: {
      title: 'محول الفيديو',
      description: 'تحويل مقاطع الفيديو بين الصيغ باستخدام متصفحك',
      invalidFile: 'الرجاء تحديد ملف فيديو صالح',
      input: 'فيديو الإدخال',
      inputDesc: 'حدد أو اسحب ملف فيديو للتحويل',
      dropzone: 'انقر أو اسحب الفيديو هنا',
      supportedFormats: 'يدعم MP4، WebM، MOV، AVI',
      settings: 'الإعدادات',
      outputFormat: 'صيغة الإخراج',
      convert: 'تحويل الفيديو',
      converting: 'جاري التحويل...',
      noCodecSupport: 'لم يتم العثور على برنامج ترميز فيديو مدعوم',
      result: 'النتيجة',
      codecUsed: 'برنامج الترميز المستخدم',
      download: 'تحميل'
    }
  },
  hi: {
    playground: {
      input: 'इनपुट',
      capture: {
        removeFile: 'फ़ाइल हटाएं',
        removeFileConfirm: 'क्या आप वाकई इस फ़ाइल को हटाना चाहते हैं?'
      }
    },
    history: {
      saveTemplate: {
        button: 'टेम्पलेट के रूप में सहेजें',
        dialogTitle: 'टेम्पलेट के रूप में सहेजें',
        nameLabel: 'टेम्पलेट का नाम',
        namePlaceholder: 'टेम्पलेट का नाम दर्ज करें',
        success: 'टेम्पलेट सहेजा गया',
        successDesc: 'टेम्पलेट सफलतापूर्वक सहेजा गया।',
        error: 'सहेजना विफल',
        noInputsTitle: 'टेम्पलेट सहेज नहीं सकते',
        noInputsDesc: 'इस इतिहास रिकॉर्ड के लिए इनपुट पैरामीटर उपलब्ध नहीं हैं।',
        duplicateName: 'इस नाम का टेम्पलेट पहले से मौजूद है। कृपया कोई अलग नाम चुनें।'
      }
    },
    videoConverter: {
      title: 'वीडियो कनवर्टर',
      description: 'अपने ब्राउज़र का उपयोग करके वीडियो को फॉर्मेट के बीच कनवर्ट करें',
      invalidFile: 'कृपया एक वैध वीडियो फ़ाइल चुनें',
      input: 'इनपुट वीडियो',
      inputDesc: 'कनवर्ट करने के लिए एक वीडियो फ़ाइल चुनें या खींचें',
      dropzone: 'क्लिक करें या वीडियो यहां खींचें',
      supportedFormats: 'MP4, WebM, MOV, AVI समर्थित',
      settings: 'सेटिंग्स',
      outputFormat: 'आउटपुट फॉर्मेट',
      convert: 'वीडियो कनवर्ट करें',
      converting: 'कनवर्ट हो रहा है...',
      noCodecSupport: 'कोई समर्थित वीडियो कोडेक नहीं मिला',
      result: 'परिणाम',
      codecUsed: 'उपयोग किया गया कोडेक',
      download: 'डाउनलोड'
    }
  },
  id: {
    playground: {
      input: 'Input',
      capture: {
        removeFile: 'Hapus File',
        removeFileConfirm: 'Apakah Anda yakin ingin menghapus file ini?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Simpan sebagai Template',
        dialogTitle: 'Simpan sebagai Template',
        nameLabel: 'Nama Template',
        namePlaceholder: 'Masukkan nama template',
        success: 'Template Tersimpan',
        successDesc: 'Template telah berhasil disimpan.',
        error: 'Gagal Menyimpan',
        noInputsTitle: 'Tidak Dapat Menyimpan Template',
        noInputsDesc: 'Parameter input tidak tersedia untuk catatan riwayat ini.',
        duplicateName: 'Template dengan nama ini sudah ada. Silakan pilih nama yang berbeda.'
      }
    },
    videoConverter: {
      title: 'Konverter Video',
      description: 'Konversi video antar format menggunakan browser Anda',
      invalidFile: 'Silakan pilih file video yang valid',
      input: 'Video Input',
      inputDesc: 'Pilih atau seret file video untuk dikonversi',
      dropzone: 'Klik atau seret video ke sini',
      supportedFormats: 'Mendukung MP4, WebM, MOV, AVI',
      settings: 'Pengaturan',
      outputFormat: 'Format Output',
      convert: 'Konversi Video',
      converting: 'Mengkonversi...',
      noCodecSupport: 'Tidak ditemukan codec video yang didukung',
      result: 'Hasil',
      codecUsed: 'Codec yang digunakan',
      download: 'Unduh'
    }
  },
  ms: {
    playground: {
      input: 'Input',
      capture: {
        removeFile: 'Buang Fail',
        removeFileConfirm: 'Adakah anda pasti mahu membuang fail ini?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Simpan sebagai Templat',
        dialogTitle: 'Simpan sebagai Templat',
        nameLabel: 'Nama Templat',
        namePlaceholder: 'Masukkan nama templat',
        success: 'Templat Disimpan',
        successDesc: 'Templat telah berjaya disimpan.',
        error: 'Gagal Menyimpan',
        noInputsTitle: 'Tidak Dapat Menyimpan Templat',
        noInputsDesc: 'Parameter input tidak tersedia untuk rekod sejarah ini.',
        duplicateName: 'Templat dengan nama ini sudah wujud. Sila pilih nama yang berbeza.'
      }
    },
    videoConverter: {
      title: 'Penukar Video',
      description: 'Tukar video antara format menggunakan pelayar anda',
      invalidFile: 'Sila pilih fail video yang sah',
      input: 'Video Input',
      inputDesc: 'Pilih atau seret fail video untuk ditukar',
      dropzone: 'Klik atau seret video ke sini',
      supportedFormats: 'Menyokong MP4, WebM, MOV, AVI',
      settings: 'Tetapan',
      outputFormat: 'Format Output',
      convert: 'Tukar Video',
      converting: 'Menukar...',
      noCodecSupport: 'Tiada codec video yang disokong ditemui',
      result: 'Hasil',
      codecUsed: 'Codec yang digunakan',
      download: 'Muat turun'
    }
  },
  th: {
    playground: {
      input: 'อินพุต',
      capture: {
        removeFile: 'ลบไฟล์',
        removeFileConfirm: 'คุณแน่ใจหรือไม่ว่าต้องการลบไฟล์นี้?'
      }
    },
    history: {
      saveTemplate: {
        button: 'บันทึกเป็นเทมเพลต',
        dialogTitle: 'บันทึกเป็นเทมเพลต',
        nameLabel: 'ชื่อเทมเพลต',
        namePlaceholder: 'ป้อนชื่อเทมเพลต',
        success: 'บันทึกเทมเพลตแล้ว',
        successDesc: 'บันทึกเทมเพลตเรียบร้อยแล้ว',
        error: 'บันทึกล้มเหลว',
        noInputsTitle: 'ไม่สามารถบันทึกเทมเพลตได้',
        noInputsDesc: 'พารามิเตอร์อินพุตไม่พร้อมใช้งานสำหรับบันทึกประวัตินี้',
        duplicateName: 'มีเทมเพลตชื่อนี้อยู่แล้ว กรุณาเลือกชื่ออื่น'
      }
    },
    videoConverter: {
      title: 'ตัวแปลงวิดีโอ',
      description: 'แปลงวิดีโอระหว่างรูปแบบโดยใช้เบราว์เซอร์ของคุณ',
      invalidFile: 'กรุณาเลือกไฟล์วิดีโอที่ถูกต้อง',
      input: 'วิดีโออินพุต',
      inputDesc: 'เลือกหรือลากไฟล์วิดีโอเพื่อแปลง',
      dropzone: 'คลิกหรือลากวิดีโอมาที่นี่',
      supportedFormats: 'รองรับ MP4, WebM, MOV, AVI',
      settings: 'การตั้งค่า',
      outputFormat: 'รูปแบบเอาต์พุต',
      convert: 'แปลงวิดีโอ',
      converting: 'กำลังแปลง...',
      noCodecSupport: 'ไม่พบตัวแปลงสัญญาณวิดีโอที่รองรับ',
      result: 'ผลลัพธ์',
      codecUsed: 'ตัวแปลงสัญญาณที่ใช้',
      download: 'ดาวน์โหลด'
    }
  },
  vi: {
    playground: {
      input: 'Đầu vào',
      capture: {
        removeFile: 'Xóa tệp',
        removeFileConfirm: 'Bạn có chắc chắn muốn xóa tệp này không?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Lưu làm mẫu',
        dialogTitle: 'Lưu làm mẫu',
        nameLabel: 'Tên mẫu',
        namePlaceholder: 'Nhập tên mẫu',
        success: 'Đã lưu mẫu',
        successDesc: 'Mẫu đã được lưu thành công.',
        error: 'Lưu thất bại',
        noInputsTitle: 'Không thể lưu mẫu',
        noInputsDesc: 'Các tham số đầu vào không khả dụng cho bản ghi lịch sử này.',
        duplicateName: 'Đã có mẫu với tên này. Vui lòng chọn tên khác.'
      }
    },
    videoConverter: {
      title: 'Trình Chuyển Đổi Video',
      description: 'Chuyển đổi video giữa các định dạng bằng trình duyệt của bạn',
      invalidFile: 'Vui lòng chọn tệp video hợp lệ',
      input: 'Video Đầu Vào',
      inputDesc: 'Chọn hoặc kéo tệp video để chuyển đổi',
      dropzone: 'Nhấp hoặc kéo video vào đây',
      supportedFormats: 'Hỗ trợ MP4, WebM, MOV, AVI',
      settings: 'Cài Đặt',
      outputFormat: 'Định Dạng Đầu Ra',
      convert: 'Chuyển Đổi Video',
      converting: 'Đang chuyển đổi...',
      noCodecSupport: 'Không tìm thấy codec video được hỗ trợ',
      result: 'Kết Quả',
      codecUsed: 'Codec đã sử dụng',
      download: 'Tải Xuống'
    }
  },
  tr: {
    playground: {
      input: 'Giriş',
      capture: {
        removeFile: 'Dosyayı Kaldır',
        removeFileConfirm: 'Bu dosyayı kaldırmak istediğinizden emin misiniz?'
      }
    },
    history: {
      saveTemplate: {
        button: 'Şablon Olarak Kaydet',
        dialogTitle: 'Şablon Olarak Kaydet',
        nameLabel: 'Şablon Adı',
        namePlaceholder: 'Şablon adını girin',
        success: 'Şablon Kaydedildi',
        successDesc: 'Şablon başarıyla kaydedildi.',
        error: 'Kaydetme Başarısız',
        noInputsTitle: 'Şablon Kaydedilemedi',
        noInputsDesc: 'Bu geçmiş kaydı için giriş parametreleri mevcut değil.',
        duplicateName: 'Bu isimde bir şablon zaten var. Lütfen farklı bir isim seçin.'
      }
    },
    videoConverter: {
      title: 'Video Dönüştürücü',
      description: 'Tarayıcınızı kullanarak videoları formatlar arasında dönüştürün',
      invalidFile: 'Lütfen geçerli bir video dosyası seçin',
      input: 'Giriş Videosu',
      inputDesc: 'Dönüştürmek için bir video dosyası seçin veya sürükleyin',
      dropzone: 'Videoyu buraya tıklayın veya sürükleyin',
      supportedFormats: 'MP4, WebM, MOV, AVI desteklenir',
      settings: 'Ayarlar',
      outputFormat: 'Çıkış Formatı',
      convert: 'Videoyu Dönüştür',
      converting: 'Dönüştürülüyor...',
      noCodecSupport: 'Desteklenen video codec bulunamadı',
      result: 'Sonuç',
      codecUsed: 'Kullanılan codec',
      download: 'İndir'
    }
  }
}

// Deep merge function
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(
        (target[key] as Record<string, unknown>) || {},
        source[key] as Record<string, unknown>
      )
    } else {
      result[key] = source[key]
    }
  }
  return result
}

// Add mobile translations to each language
Object.entries(mobileTranslations).forEach(([lang, translations]) => {
  const existingBundle = i18n.getResourceBundle(lang, 'translation') || {}
  const mergedBundle = deepMerge(existingBundle, translations)
  i18n.addResourceBundle(lang, 'translation', mergedBundle, true, true)
})

export default i18n
