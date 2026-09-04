'use client';

import React, { useState, useMemo, useRef } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Search, File, Save, AlertCircle, Image as ImageIcon, Smile } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../contexts/translation-context';
import { toast } from 'sonner';

// Importar iconos comunes para preview
import {
  Home, User, Settings, Heart, Star, Mail, Phone, Calendar, Camera, Edit, Trash, Trash2, Plus, Minus, X, Zap, Move, RotateCcw,
  Activity, AlertCircle as AlertCircleIcon, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AtSign, Award, Bell,
  Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard, Clock, Cloud, Code, Command,
  CreditCard, Database, Disc, Download, ExternalLink, Filter, Flag, Folder, Gift, Globe, Grid, Grid3X3, HardDrive, Hash,
  Headphones, Inbox, Info, Key, Layers, LifeBuoy, Link, List, Lock, LogIn, LogOut, Map, Menu, MessageCircle,
  MessageSquare, Mic, Monitor, Moon, MoreHorizontal, MoreVertical, MousePointer, Music, Navigation, Package,
  Paperclip, Pause, PenTool, Play, Power, Printer, QrCode, Repeat, Rss, Scissors, Send, Share, Shield, ShoppingBag,
  ShoppingCart, Sun, Tag, Target, Terminal, ThumbsDown, ThumbsUp, ToggleLeft, ToggleRight, TrendingDown, TrendingUp,
  Truck, Tv, Umbrella, Unlock, Upload, Users, Video, Voicemail, Volume1, Volume2, VolumeX, Wallet, Watch, Wifi,
  ZoomIn, ZoomOut,
} from 'lucide-react';

// Importar Heroicons comunes para preview
import { sessionFetch } from '@/lib/projectStore';
import {
  HomeIcon, UserIcon, CogIcon, HeartIcon, StarIcon, EnvelopeIcon, PhoneIcon, CalendarIcon, CameraIcon, PencilIcon,
  TrashIcon, PlusIcon, MinusIcon, XMarkIcon, BoltIcon, ArrowPathIcon, AdjustmentsHorizontalIcon, BellIcon, BookmarkIcon,
  CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, ClipboardIcon, ClockIcon,
  CloudIcon, CodeBracketIcon, CommandLineIcon, CreditCardIcon, CircleStackIcon, DocumentIcon, ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon, FunnelIcon, FlagIcon, FolderIcon, GiftIcon, GlobeAltIcon, Squares2X2Icon, CpuChipIcon,
  HashtagIcon, InboxIcon, InformationCircleIcon, KeyIcon, Bars3Icon, LinkIcon, ListBulletIcon, LockClosedIcon,
  ArrowLeftEndOnRectangleIcon, ArrowRightEndOnRectangleIcon, MapIcon, Bars3BottomLeftIcon, ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon, MicrophoneIcon, ComputerDesktopIcon, MoonIcon, EllipsisHorizontalIcon, EllipsisVerticalIcon,
  CursorArrowRaysIcon, MusicalNoteIcon, ArrowSmallUpIcon, PaperClipIcon, PauseIcon, PlayIcon, PowerIcon,
  PrinterIcon, QrCodeIcon, ArrowPathRoundedSquareIcon, RssIcon, ScissorsIcon, PaperAirplaneIcon, ShareIcon, ShieldCheckIcon,
  ShoppingBagIcon, ShoppingCartIcon, SunIcon, TagIcon, CursorArrowRippleIcon, CommandLineIcon as TerminalIcon,
  HandThumbDownIcon, HandThumbUpIcon, ArrowsRightLeftIcon, TruckIcon, TvIcon, LockOpenIcon, Square2StackIcon,
  ArrowUpTrayIcon, UsersIcon, VideoCameraIcon, SpeakerWaveIcon, SpeakerXMarkIcon, WalletIcon, WrenchIcon,
  WifiIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, MagnifyingGlassIcon, EyeIcon, 
  ArrowUturnLeftIcon, ChartBarIcon, DocumentTextIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon, BeakerIcon,
  BookmarkSlashIcon, BriefcaseIcon, BugAntIcon, BuildingOfficeIcon, CakeIcon, CalculatorIcon, CalendarDaysIcon,
  CheckCircleIcon, ChevronDoubleDownIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChevronDoubleUpIcon,
  ClipboardDocumentCheckIcon, ClipboardDocumentIcon, ClipboardDocumentListIcon, CloudArrowDownIcon, CloudArrowUpIcon,
  Cog6ToothIcon, Cog8ToothIcon, DocumentArrowDownIcon, DocumentArrowUpIcon, DocumentChartBarIcon, DocumentCheckIcon,
  DocumentDuplicateIcon, DocumentMagnifyingGlassIcon, DocumentMinusIcon, DocumentPlusIcon, ExclamationCircleIcon,
  ExclamationTriangleIcon, EyeDropperIcon, EyeSlashIcon, FingerPrintIcon, FireIcon, FlagIcon as FlagIconHero,
  FolderArrowDownIcon, FolderMinusIcon, FolderOpenIcon, FolderPlusIcon, ForwardIcon, FunnelIcon as FunnelIconHero,
  GifIcon, GiftIcon as GiftIconHero, GlobeAmericasIcon, GlobeAsiaAustraliaIcon, GlobeEuropeAfricaIcon, HandRaisedIcon,
  IdentificationIcon, InboxArrowDownIcon, InboxStackIcon, KeyIcon as KeyIconHero, LanguageIcon, LifebuoyIcon,
  LightBulbIcon, MagnifyingGlassCircleIcon, MegaphoneIcon, NewspaperIcon, NoSymbolIcon, PaintBrushIcon, PencilSquareIcon,
  PhotoIcon, PresentationChartBarIcon, PresentationChartLineIcon, PuzzlePieceIcon, QuestionMarkCircleIcon, RectangleStackIcon,
  RocketLaunchIcon, ScaleIcon, ServerIcon, ServerStackIcon, SignalIcon, SignalSlashIcon, SparklesIcon, SquaresPlusIcon,
  StopIcon, SwatchIcon, TableCellsIcon, TicketIcon, TrophyIcon, TruckIcon as TruckIconHero, UserCircleIcon, UserGroupIcon,
  UserMinusIcon, UserPlusIcon, UsersIcon as UsersIconHero, VariableIcon, VideoCameraIcon as VideoCameraIconHero, BookOpenIcon,
  ViewfinderCircleIcon, WalletIcon as WalletIconHero, WrenchIcon as WrenchIconHero, WrenchScrewdriverIcon, CubeTransparentIcon,
} from '@heroicons/react/24/outline';

const HEROICON_MAP: Record<string, React.ElementType> = {
  home: HomeIcon, homeIcon: HomeIcon, user: UserIcon, userIcon: UserIcon, settings: CogIcon, cog: CogIcon, cogIcon: CogIcon, settingsIcon: CogIcon,
  heart: HeartIcon, heartIcon: HeartIcon, star: StarIcon, starIcon: StarIcon, mail: EnvelopeIcon, envelope: EnvelopeIcon, envelopeIcon: EnvelopeIcon,
  phone: PhoneIcon, phoneIcon: PhoneIcon, calendar: CalendarIcon, calendarIcon: CalendarIcon, calendarDays: CalendarDaysIcon,
  camera: CameraIcon, cameraIcon: CameraIcon, edit: PencilIcon, pencil: PencilIcon, pencilIcon: PencilIcon, editIcon: PencilIcon, LockClosedIcon: LockClosedIcon, LockOpenIcon: LockOpenIcon, 
  trash: TrashIcon, trashIcon: TrashIcon, plus: PlusIcon, plusIcon: PlusIcon, minus: MinusIcon, minusIcon: MinusIcon, CubeTransparentIcon: CubeTransparentIcon, Cog6ToothIcon: Cog6ToothIcon, Cog8ToothIcon: Cog8ToothIcon, DocumentArrowDownIcon: DocumentArrowDownIcon, DocumentArrowUpIcon: DocumentArrowUpIcon,
  x: XMarkIcon, xMark: XMarkIcon, xMarkIcon: XMarkIcon, xIcon: XMarkIcon, zap: BoltIcon, bolt: BoltIcon, boltIcon: BoltIcon, ChevronDownIcon: ChevronDownIcon, ChevronLeftIcon: ChevronLeftIcon, ChevronRightIcon: ChevronRightIcon, ChevronUpIcon: ChevronUpIcon,
  rotateCcw: ArrowPathIcon, arrowPath: ArrowPathIcon, arrowPathIcon: ArrowPathIcon, activity: AdjustmentsHorizontalIcon, MagnifyingGlassPlusIcon: MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon: MagnifyingGlassMinusIcon,
  alertCircle: ExclamationCircleIcon, exclamationCircle: ExclamationCircleIcon, exclamationCircleIcon: ExclamationCircleIcon, PhotoIcon: PhotoIcon, EyeIcon: EyeIcon, EyeSlashIcon: EyeSlashIcon,
  archive: FolderOpenIcon, folderOpen: FolderOpenIcon, folderOpenIcon: FolderOpenIcon, arrowDown: ArrowDownTrayIcon, BookOpenIcon: BookOpenIcon, 
  arrowLeft: ArrowLeftEndOnRectangleIcon, arrowRight: ArrowRightEndOnRectangleIcon, arrowUp: ArrowUpTrayIcon,
  atSign: AtSign, atSignIcon: AtSign, award: TrophyIcon, trophy: TrophyIcon, trophyIcon: TrophyIcon, bell: BellIcon, bellIcon: BellIcon,
  bookmark: BookmarkIcon, bookmarkIcon: BookmarkIcon, bookmarkSlash: BookmarkSlashIcon, check: CheckIcon, checkIcon: CheckIcon,
  checkCircle: CheckCircleIcon, checkCircleIcon: CheckCircleIcon, chevronDown: ChevronDownIcon, chevronDownIcon: ChevronDownIcon,
  chevronLeft: ChevronLeftIcon, chevronLeftIcon: ChevronLeftIcon, chevronRight: ChevronRightIcon, chevronRightIcon: ChevronRightIcon,
  chevronUp: ChevronUpIcon, chevronUpIcon: ChevronUpIcon, chevronDoubleDown: ChevronDoubleDownIcon, chevronDoubleLeft: ChevronDoubleLeftIcon,
  chevronDoubleRight: ChevronDoubleRightIcon, chevronDoubleUp: ChevronDoubleUpIcon, ArrowDownTrayIcon: ArrowDownTrayIcon, clipboardIcon: ClipboardIcon, clipboardDocument: ClipboardDocumentIcon, clipboardDocumentList: ClipboardDocumentListIcon,
  clipboardDocumentCheck: ClipboardDocumentCheckIcon, clock: ClockIcon, clockIcon: ClockIcon, cloud: CloudIcon, cloudIcon: CloudIcon,
  cloudArrowDown: CloudArrowDownIcon, cloudArrowUp: CloudArrowUpIcon, code: CodeBracketIcon, codeBracket: CodeBracketIcon,
  codeBracketIcon: CodeBracketIcon, command: CommandLineIcon, commandLine: CommandLineIcon, commandLineIcon: CommandLineIcon, EyeDropperIcon: EyeDropperIcon, PaintBrushIcon: PaintBrushIcon, BeakerIcon: BeakerIcon, BookmarkSlashIcon: BookmarkSlashIcon, BriefcaseIcon: BriefcaseIcon, BugAntIcon: BugAntIcon, BuildingOfficeIcon: BuildingOfficeIcon, CakeIcon: CakeIcon, CalculatorIcon: CalculatorIcon, CalendarDaysIcon: CalendarDaysIcon,
  creditCard: CreditCardIcon, creditCardIcon: CreditCardIcon, database: CircleStackIcon, circleStack: CircleStackIcon,
  circleStackIcon: CircleStackIcon, databaseIcon: CircleStackIcon, disc: DocumentIcon, document: DocumentIcon, documentIcon: DocumentIcon,
  download: ArrowDownTrayIcon, arrowDownTray: ArrowDownTrayIcon, arrowDownTrayIcon: ArrowDownTrayIcon, externalLink: ArrowTopRightOnSquareIcon, ViewfinderCircleIcon: ViewfinderCircleIcon, AdjustmentsHorizontalIcon: AdjustmentsHorizontalIcon,
  arrowTopRightOnSquare: ArrowTopRightOnSquareIcon, filter: FunnelIcon, funnel: FunnelIcon, funnelIcon: FunnelIconHero, FolderOpenIcon: FolderOpenIcon, DocumentDuplicateIcon: DocumentDuplicateIcon, XMarkIcon: XMarkIcon, Squares2X2Icon: Squares2X2Icon, CpuChipIcon: CpuChipIcon, HashtagIcon: HashtagIcon, InboxIcon: InboxIcon, InformationCircleIcon: InformationCircleIcon,
  flag: FlagIconHero, flagIcon: FlagIconHero, folder: FolderIcon, folderIcon: FolderIcon, folderMinus: FolderMinusIcon, 
  folderPlus: FolderPlusIcon, folderArrowDown: FolderArrowDownIcon, gift: GiftIconHero, giftIcon: GiftIconHero, gif: GifIcon,
  globe: GlobeAltIcon, globeAlt: GlobeAltIcon, globeAltIcon: GlobeAltIcon, globeAmericas: GlobeAmericasIcon, Square2StackIcon: Square2StackIcon,
  globeAsiaAustralia: GlobeAsiaAustraliaIcon, globeEuropeAfrica: GlobeEuropeAfricaIcon, grid: Squares2X2Icon, squares2X2: Squares2X2Icon,
  grid3X3: Squares2X2Icon, squaresPlus: SquaresPlusIcon, hardDrive: CpuChipIcon, cpuChip: CpuChipIcon, cpuChipIcon: CpuChipIcon,
  hash: HashtagIcon, hashtag: HashtagIcon, hashtagIcon: HashtagIcon, headphones: SpeakerWaveIcon, inbox: InboxIcon, inboxIcon: InboxIcon,
  inboxArrowDown: InboxArrowDownIcon, inboxStack: InboxStackIcon, info: InformationCircleIcon, informationCircle: InformationCircleIcon,
  informationCircleIcon: InformationCircleIcon, key: KeyIconHero, keyIcon: KeyIconHero, layers: RectangleStackIcon, ArrowUpTrayIcon: ArrowUpTrayIcon,
  rectangleStack: RectangleStackIcon, rectangleStackIcon: RectangleStackIcon, lifeBuoy: LifebuoyIcon, lifebuoy: LifebuoyIcon,
  lifebuoyIcon: LifebuoyIcon, link: LinkIcon, linkIcon: LinkIcon, list: ListBulletIcon, listBullet: ListBulletIcon, ArrowUturnLeftIcon: ArrowUturnLeftIcon, ArrowUturnRightIcon: ArrowPathIcon, ArrowsRightLeftIcon: ArrowsRightLeftIcon,
  listBulletIcon: ListBulletIcon, lock: LockClosedIcon, lockClosed: LockClosedIcon, lockClosedIcon: LockClosedIcon, HandRaisedIcon: HandRaisedIcon, CursorArrowRaysIcon: CursorArrowRaysIcon, MusicalNoteIcon: MusicalNoteIcon, ArrowSmallUpIcon: ArrowSmallUpIcon, PaperClipIcon: PaperClipIcon,
  logIn: ArrowLeftEndOnRectangleIcon, arrowLeftEndOnRectangle: ArrowLeftEndOnRectangleIcon, logOut: ArrowRightEndOnRectangleIcon,
  arrowRightEndOnRectangle: ArrowRightEndOnRectangleIcon, map: MapIcon, mapIcon: MapIcon, menu: Bars3Icon, bars3: Bars3Icon,
  bars3Icon: Bars3Icon, bars3BottomLeft: Bars3BottomLeftIcon, messageCircle: ChatBubbleLeftIcon, chatBubbleLeft: ChatBubbleLeftIcon,
  messageSquare: ChatBubbleLeftRightIcon, chatBubbleLeftRight: ChatBubbleLeftRightIcon, mic: MicrophoneIcon, microphone: MicrophoneIcon,
  microphoneIcon: MicrophoneIcon, monitor: ComputerDesktopIcon, computerDesktop: ComputerDesktopIcon, computerDesktopIcon: ComputerDesktopIcon,
  moon: MoonIcon, moonIcon: MoonIcon, moreHorizontal: EllipsisHorizontalIcon, ellipsisHorizontal: EllipsisHorizontalIcon,
  ellipsisHorizontalIcon: EllipsisHorizontalIcon, moreVertical: EllipsisVerticalIcon, ellipsisVertical: EllipsisVerticalIcon,
  ellipsisVerticalIcon: EllipsisVerticalIcon, mousePointer: CursorArrowRaysIcon, cursorArrowRays: CursorArrowRaysIcon,
  cursorArrowRaysIcon: CursorArrowRaysIcon, music: MusicalNoteIcon, musicalNote: MusicalNoteIcon, musicalNoteIcon: MusicalNoteIcon,
  navigation: ArrowSmallUpIcon, arrowSmallUp: ArrowSmallUpIcon,
  paperclip: PaperClipIcon, paperClip: PaperClipIcon, paperClipIcon: PaperClipIcon, pause: PauseIcon, pauseIcon: PauseIcon,
  penTool: PaintBrushIcon, paintBrush: PaintBrushIcon, paintBrushIcon: PaintBrushIcon, pencilSquare: PencilSquareIcon,
  play: PlayIcon, playIcon: PlayIcon, power: PowerIcon, powerIcon: PowerIcon, printer: PrinterIcon, printerIcon: PrinterIcon,
  qrCode: QrCodeIcon, qrCodeIcon: QrCodeIcon, repeat: ArrowPathRoundedSquareIcon, arrowPathRoundedSquare: ArrowPathRoundedSquareIcon,
  rss: RssIcon, rssIcon: RssIcon, scissors: ScissorsIcon, scissorsIcon: ScissorsIcon, send: PaperAirplaneIcon,
  paperAirplane: PaperAirplaneIcon, paperAirplaneIcon: PaperAirplaneIcon, share: ShareIcon, shareIcon: ShareIcon,
  shield: ShieldCheckIcon, shieldCheck: ShieldCheckIcon, shieldCheckIcon: ShieldCheckIcon, shoppingBag: ShoppingBagIcon,
  shoppingBagIcon: ShoppingBagIcon, shoppingCart: ShoppingCartIcon, shoppingCartIcon: ShoppingCartIcon, sun: SunIcon, sunIcon: SunIcon,
  tag: TagIcon, tagIcon: TagIcon, target: CursorArrowRippleIcon, cursorArrowRipple: CursorArrowRippleIcon,
  cursorArrowRippleIcon: CursorArrowRippleIcon, terminal: TerminalIcon, thumbsDown: HandThumbDownIcon, handThumbDown: HandThumbDownIcon,
  handThumbDownIcon: HandThumbDownIcon, thumbsUp: HandThumbUpIcon, handThumbUp: HandThumbUpIcon, handThumbUpIcon: HandThumbUpIcon,
  toggleLeft: ArrowsRightLeftIcon, toggleRight: ArrowsRightLeftIcon, arrowsRightLeft: ArrowsRightLeftIcon,
  trendingDown: ArrowTrendingDownIcon, arrowTrendingDown: ArrowTrendingDownIcon, trendingUp: ArrowTrendingUpIcon,
  arrowTrendingUp: ArrowTrendingUpIcon, truck: TruckIconHero, truckIcon: TruckIconHero, tv: TvIcon, tvIcon: TvIcon,
  unlock: LockOpenIcon, lockOpen: LockOpenIcon, lockOpenIcon: LockOpenIcon, PencilIcon:PencilIcon,
  upload: ArrowUpTrayIcon, arrowUpTray: ArrowUpTrayIcon, arrowUpTrayIcon: ArrowUpTrayIcon, users: UsersIconHero, usersIcon: UsersIconHero,
  userCircle: UserCircleIcon, userCircleIcon: UserCircleIcon, userGroup: UserGroupIcon, userGroupIcon: UserGroupIcon,
  userMinus: UserMinusIcon, userMinusIcon: UserMinusIcon, userPlus: UserPlusIcon, userPlusIcon: UserPlusIcon,
  video: VideoCameraIconHero, videoIcon: VideoCameraIconHero, videoCamera: VideoCameraIcon, videoCameraIcon: VideoCameraIcon,
  volume1: SpeakerWaveIcon, volume2: SpeakerWaveIcon,
  volumeX: SpeakerXMarkIcon, speakerWave: SpeakerWaveIcon, speakerWaveIcon: SpeakerWaveIcon, speakerXMark: SpeakerXMarkIcon,
  speakerXMarkIcon: SpeakerXMarkIcon, wallet: WalletIconHero, walletIcon: WalletIconHero, watch: WrenchIconHero, wrench: WrenchIconHero,
  wrenchIcon: WrenchIconHero, wrenchScrewdriver: WrenchScrewdriverIcon, wifi: WifiIcon, wifiIcon: WifiIcon,
  zoomIn: MagnifyingGlassPlusIcon, magnifyingGlassPlus: MagnifyingGlassPlusIcon, magnifyingGlassPlusIcon: MagnifyingGlassPlusIcon,
  zoomOut: MagnifyingGlassMinusIcon, magnifyingGlassMinus: MagnifyingGlassMinusIcon, magnifyingGlassMinusIcon: MagnifyingGlassMinusIcon,
  eye: EyeIcon, eyeIcon: EyeIcon, eyeSlash: EyeSlashIcon, eyeSlashIcon: EyeSlashIcon, search: MagnifyingGlassIcon,
  magnifyingGlass: MagnifyingGlassIcon, magnifyingGlassIcon: MagnifyingGlassIcon, documentText: DocumentTextIcon,
  documentTextIcon: DocumentTextIcon, documentDuplicate: DocumentDuplicateIcon, documentDuplicateIcon: DocumentDuplicateIcon,
  documentCheck: DocumentCheckIcon, documentCheckIcon: DocumentCheckIcon, documentMinus: DocumentMinusIcon,
  documentMinusIcon: DocumentMinusIcon, documentPlus: DocumentPlusIcon, documentPlusIcon: DocumentPlusIcon,
  documentArrowDown: DocumentArrowDownIcon, documentArrowDownIcon: DocumentArrowDownIcon, documentArrowUp: DocumentArrowUpIcon,
  documentArrowUpIcon: DocumentArrowUpIcon, documentChartBar: DocumentChartBarIcon, documentChartBarIcon: DocumentChartBarIcon,
  documentMagnifyingGlass: DocumentMagnifyingGlassIcon, documentMagnifyingGlassIcon: DocumentMagnifyingGlassIcon,
  chartBar: ChartBarIcon, chartBarIcon: ChartBarIcon, beaker: BeakerIcon, beakerIcon: BeakerIcon, briefcase: BriefcaseIcon,
  briefcaseIcon: BriefcaseIcon, bugAnt: BugAntIcon, bugAntIcon: BugAntIcon, buildingOffice: BuildingOfficeIcon,
  buildingOfficeIcon: BuildingOfficeIcon, cake: CakeIcon, cakeIcon: CakeIcon, calculator: CalculatorIcon, calculatorIcon: CalculatorIcon,
  checkSquare: ClipboardDocumentCheckIcon, clipboardDocumentCheckIcon: ClipboardDocumentCheckIcon, clipboardList: ClipboardDocumentListIcon, clipboardCheck: ClipboardDocumentCheckIcon,
  clone: DocumentDuplicateIcon, copy: DocumentDuplicateIcon, file: DocumentIcon,
  fileText: DocumentTextIcon, image: PhotoIcon, photo: PhotoIcon, photoIcon: PhotoIcon, layout: RectangleStackIcon,
  layoutDashboard: RectangleStackIcon, mapPin: MapIcon, minimize: ArrowsRightLeftIcon,
  maximize: ArrowsRightLeftIcon, minusCircle: MinusIcon,
  radio: SignalIcon, redo: ArrowPathIcon, refreshCw: ArrowPathIcon,
  arrowUturnLeft: ArrowUturnLeftIcon, arrowUturnLeftIcon: ArrowUturnLeftIcon,
  server: ServerIcon, serverIcon: ServerIcon, serverStack: ServerStackIcon, serverStackIcon: ServerStackIcon,
  cog6Tooth: Cog6ToothIcon, cog6ToothIcon: Cog6ToothIcon, cog8Tooth: Cog8ToothIcon, cog8ToothIcon: Cog8ToothIcon,
  share2: ForwardIcon, forward: ForwardIcon, forwardIcon: ForwardIcon, shieldAlert: ExclamationTriangleIcon,
  exclamationTriangle: ExclamationTriangleIcon, exclamationTriangleIcon: ExclamationTriangleIcon, shuffle: ArrowsRightLeftIcon, sidebar: Bars3BottomLeftIcon,
  skipBack: ArrowUturnLeftIcon, skipForward: ArrowPathIcon, slack: RectangleStackIcon, slash: NoSymbolIcon, noSymbol: NoSymbolIcon,
  noSymbolIcon: NoSymbolIcon, sliders: AdjustmentsHorizontalIcon,
  stopCircle: StopIcon, stopIcon: StopIcon, sunDim: SunIcon, sunrise: SunIcon, sunset: SunIcon,
  table: TableCellsIcon, tableCells: TableCellsIcon, tableCellsIcon: TableCellsIcon,
  thermometer: ScaleIcon,
  ticket: TicketIcon, ticketIcon: TicketIcon,
  tool: WrenchIconHero, toolbox: WrenchScrewdriverIcon, tools: WrenchScrewdriverIcon, trash2: TrashIcon,
  triangle: ExclamationTriangleIcon,
  twitch: SignalIcon, twitter: PaperAirplaneIcon, type: VariableIcon, variable: VariableIcon,
  variableIcon: VariableIcon, underline: Bars3BottomLeftIcon, undo: ArrowUturnLeftIcon,
  unlink: LinkIcon, uploadCloud: CloudArrowUpIcon,
  userCheck: CheckIcon, userX: XMarkIcon,
  view: EyeIcon, viewfinder: ViewfinderCircleIcon, viewfinderCircle: ViewfinderCircleIcon, viewfinderCircleIcon: ViewfinderCircleIcon,
  volume: SpeakerWaveIcon,
  wifiOff: WifiIcon, wind: SwatchIcon, swatch: SwatchIcon, swatchIcon: SwatchIcon,
  xCircle: XMarkIcon, xOctagon: XMarkIcon, xSquare: XMarkIcon, youtube: PlayIcon,
  zapOff: BoltIcon,
  rocket: RocketLaunchIcon, rocketLaunch: RocketLaunchIcon, rocketLaunchIcon: RocketLaunchIcon, sparkles: SparklesIcon,
  sparklesIcon: SparklesIcon, cpu: CpuChipIcon, cpuIcon: CpuChipIcon, signal: SignalIcon, signalIcon: SignalIcon,
  signalHigh: SignalIcon, signalSlash: SignalSlashIcon, signalSlashIcon: SignalSlashIcon,
  lightbulb: LightBulbIcon, lightBulb: LightBulbIcon, lightBulbIcon: LightBulbIcon,
  scale: ScaleIcon, scaleIcon: ScaleIcon, language: LanguageIcon, languageIcon: LanguageIcon, newspaper: NewspaperIcon,
  newspaperIcon: NewspaperIcon, megaphone: MegaphoneIcon, megaphoneIcon: MegaphoneIcon, identification: IdentificationIcon,
  identificationIcon: IdentificationIcon, handRaised: HandRaisedIcon, handRaisedIcon: HandRaisedIcon, puzzlePiece: PuzzlePieceIcon,
  puzzlePieceIcon: PuzzlePieceIcon, questionMarkCircle: QuestionMarkCircleIcon, questionMarkCircleIcon: QuestionMarkCircleIcon,
  presentationChartBar: PresentationChartBarIcon, presentationChartBarIcon: PresentationChartBarIcon,
  presentationChartLine: PresentationChartLineIcon, presentationChartLineIcon: PresentationChartLineIcon,
  magnifyingGlassCircle: MagnifyingGlassCircleIcon, magnifyingGlassCircleIcon: MagnifyingGlassCircleIcon,
  fire: FireIcon, fireIcon: FireIcon, fingerPrint: FingerPrintIcon, fingerPrintIcon: FingerPrintIcon,
  eyeDropper: EyeDropperIcon, eyeDropperIcon: EyeDropperIcon,
};

const ICON_MAP: Record<string, React.ElementType> = {
  home: Home, user: User, settings: Settings, heart: Heart, star: Star, mail: Mail, phone: Phone,
  calendar: Calendar, camera: Camera, edit: Edit, trash: Trash, trash2: Trash2, plus: Plus, minus: Minus, x: X, zap: Zap,
  move: Move, rotateCcw: RotateCcw, activity: Activity, alertCircle: AlertCircleIcon, archive: Archive,
  arrowDown: ArrowDown, arrowLeft: ArrowLeft, arrowRight: ArrowRight, arrowUp: ArrowUp, atSign: AtSign,
  award: Award, bell: Bell, bookmark: Bookmark, check: Check, chevronDown: ChevronDown, chevronLeft: ChevronLeft,
  chevronRight: ChevronRight, chevronUp: ChevronUp, circle: Circle, clipboard: Clipboard, clock: Clock,
  cloud: Cloud, code: Code, command: Command, creditCard: CreditCard, database: Database, disc: Disc,
  download: Download, externalLink: ExternalLink, filter: Filter, flag: Flag, folder: Folder, gift: Gift,
  globe: Globe, grid: Grid, grid3X3: Grid3X3, hardDrive: HardDrive, hash: Hash, headphones: Headphones, inbox: Inbox,
  info: Info, key: Key, layers: Layers, lifeBuoy: LifeBuoy, link: Link, list: List, lock: Lock,
  logIn: LogIn, logOut: LogOut, map: Map, menu: Menu, messageCircle: MessageCircle, messageSquare: MessageSquare,
  mic: Mic, monitor: Monitor, moon: Moon, moreHorizontal: MoreHorizontal, moreVertical: MoreVertical,
  mousePointer: MousePointer, music: Music, navigation: Navigation, package: Package, paperclip: Paperclip,
  pause: Pause, penTool: PenTool, play: Play, power: Power, printer: Printer, qrCode: QrCode,
  repeat: Repeat, rss: Rss, scissors: Scissors, send: Send, share: Share, shield: Shield,
  shoppingBag: ShoppingBag, shoppingCart: ShoppingCart, sun: Sun, tag: Tag, target: Target,
  terminal: Terminal, thumbsDown: ThumbsDown, thumbsUp: ThumbsUp, toggleLeft: ToggleLeft,
  toggleRight: ToggleRight, trendingDown: TrendingDown, trendingUp: TrendingUp, truck: Truck, tv: Tv,
  umbrella: Umbrella, unlock: Unlock, upload: Upload, users: Users, video: Video, voicemail: Voicemail,
  volume1: Volume1, volume2: Volume2, volumeX: VolumeX, wallet: Wallet, watch: Watch, wifi: Wifi,
  zoomIn: ZoomIn, zoomOut: ZoomOut,
};

interface FileIconEditorProps {
  projectFiles: Map<string, string>;
  onSaveFile: (filePath: string, newContent: string) => Promise<boolean>;
  onRefreshFiles?: () => Promise<void>;
  isLoading?: boolean;
  devServerUrl?: string;
  projectPath?: string;
}

function toCamelCase(name: string | undefined): string {
  if (!name) return '';
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .replace(/(\d)-x-(\d)/g, '$1x$2')
    .toLowerCase();
}

function getIconPreview(
  name: string | undefined,
  source?: 'lucide-react' | '@heroicons/react' | 'custom-png',
  pngPath?: string,
  devServerUrl?: string,
) {
  if (source === 'custom-png' && pngPath) {
    const src = pngPath.startsWith('/') ? pngPath : `/${pngPath}`;
    const fileName = src.split('/').pop() || 'PNG';
    const imgSrc = devServerUrl ? `${devServerUrl.replace(/\/+$/, '')}${src}` : src;
    return (
      <img
        src={imgSrc}
        alt="preview"
        className="w-full h-full object-contain"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            const fallback = document.createElement('div');
            fallback.className = 'flex flex-col items-center justify-center text-muted-foreground/80 w-full h-full px-1 gap-1';
            fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground/80"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span class="text-[8px] text-center leading-none break-all max-w-full">${fileName}</span>`;
            parent.appendChild(fallback);
          }
        }}
      />
    );
  }

  if (!name) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground">
        <Smile size={20} />
        <span className="text-[8px] mt-1">Preview</span>
      </div>
    );
  }

  let key = toCamelCase(name);
  let IconComponent: React.ElementType | undefined;

  // Si es heroicons o el nombre termina en Icon, buscar primero en HEROICON_MAP
  if (source === '@heroicons/react' || name.endsWith('Icon')) {
    // Buscar con el nombre exacto (ej: homeIcon)
    IconComponent = HEROICON_MAP[key];
    if (!IconComponent && key.endsWith('Icon')) {
      // Buscar sin el sufijo Icon (ej: home)
      const keyNoSuffix = key.slice(0, -4);
      IconComponent = HEROICON_MAP[keyNoSuffix];
    }
    // También buscar con el nombre original en minúscula
    if (!IconComponent) {
      IconComponent = HEROICON_MAP[key.toLowerCase()];
    }
  }

  // Fallback a lucide
  if (!IconComponent) {
    IconComponent = ICON_MAP[key];
  }
  if (!IconComponent && key.endsWith('Icon')) {
    key = key.slice(0, -4);
    IconComponent = ICON_MAP[key];
  }
  if (!IconComponent) {
    IconComponent = ICON_MAP[key.toLowerCase()];
  }

  if (IconComponent) {
    return <IconComponent size={32} strokeWidth={2} className="text-foreground" />;
  }

  const kebabName = toKebabCase(name);
  const cdnUrl = `https://unpkg.com/lucide-static@latest/icons/${kebabName}.svg`;
  return (
    <img
      src={cdnUrl}
      alt={name}
      width={32}
      height={32}
      className="text-foreground"
      style={{ filter: 'invert(1)' }}
      onError={(e) => {
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        const parent = target.parentElement;
        if (parent) {
          const fallback = document.createElement('div');
          fallback.className = 'flex flex-col items-center justify-center text-muted-foreground w-full h-full';
          fallback.innerHTML = `<div>${name.slice(0, 8)}</div>`;
          parent.appendChild(fallback);
        }
      }}
    />
  );
}

interface IconGroup {
  localName: string;
  lucideName: string;
  count: number;
  line: number;
  source: 'lucide-react' | '@heroicons/react' | 'custom-png';
  pngPath?: string;
}

function extractIconGroups(content: string): IconGroup[] {
  const groups: Record<string, IconGroup> = {};

  // 1. Detectar imports de lucide-react
  const lucideRegex = /import\s*\{\s*([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  let importMatch;
  while ((importMatch = lucideRegex.exec(content)) !== null) {
    const importList = importMatch[1];
    const names = importList.split(',').map(n => n.trim());
    for (const nameDef of names) {
      if (!nameDef) continue;
      const parts = nameDef.split(/\s+as\s+/);
      const lucideName = parts[0].trim();
      const localName = parts.length > 1 ? parts[1].trim() : lucideName;
      if (!localName) continue;

      const line = content.substring(0, importMatch.index).split('\n').length;
      groups[localName] = {
        localName,
        lucideName,
        count: 0,
        line,
        source: 'lucide-react',
      };
    }
  }

  // 2. Detectar imports de @heroicons/react
  const heroiconsRegex = /import\s*\{\s*([^}]+)\}\s*from\s*['"]@heroicons\/react[^'"]*['"]/g;
  while ((importMatch = heroiconsRegex.exec(content)) !== null) {
    const importList = importMatch[1];
    const names = importList.split(',').map(n => n.trim());
    for (const nameDef of names) {
      if (!nameDef) continue;
      const parts = nameDef.split(/\s+as\s+/);
      const heroName = parts[0].trim();
      const localName = parts.length > 1 ? parts[1].trim() : heroName;
      if (!localName) continue;

      const line = content.substring(0, importMatch.index).split('\n').length;
      groups[localName] = {
        localName,
        lucideName: heroName,
        count: 0,
        line,
        source: '@heroicons/react',
      };
    }
  }

  // 3. Contar usos JSX
  for (const localName of Object.keys(groups)) {
    const jsxRegex = new RegExp(`<${localName}\\b`, 'g');
    let count = 0;
    while (jsxRegex.exec(content)) count++;
    groups[localName].count = count;
  }

  // 4. Detectar iconos personalizados PNG (reemplazados previamente)
  // Regex permisivo: soporta src={"..."}, src='...', src="...", espacios alrededor de =, etc.
  const imgIconRegex = /<img\s+[^>]*?\balt\s*=\s*["']icon["'][^>]*?>/g;
  let imgMatch;
  while ((imgMatch = imgIconRegex.exec(content)) !== null) {
    const fullTag = imgMatch[0];
    const dataIconName = fullTag.match(/data-icon-name\s*=\s*["']([^"']+)["']/)?.[1];
    // Intentar capturar src con comillas simples, dobles, backticks o llaves
    const srcMatch =
      fullTag.match(/src\s*=\s*\{["'`]([^"'`]+)["'`]\}/) ||
      fullTag.match(/src\s*=\s*["']([^"']+)["']/);
    const pngPath = srcMatch?.[1];
    if (!pngPath) continue;

    const localName = dataIconName || pngPath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'custom-icon';
    const line = content.substring(0, imgMatch.index).split('\n').length;

    if (!groups[localName]) {
      groups[localName] = {
        localName,
        lucideName: localName,
        count: 0,
        line,
        source: 'custom-png',
        pngPath,
      };
    }
    groups[localName].count++;
  }

  return Object.values(groups);
}

export function FileIconEditor({
  projectFiles,
  onSaveFile,
  onRefreshFiles,
  devServerUrl,
  projectPath,
}: FileIconEditorProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editingIcons, setEditingIcons] = useState<Record<string, { newName: string; isPng: boolean; pngPath: string }>>({});
  const [localPngUrls, setLocalPngUrls] = useState<Record<string, string>>({});
  const [activePickerIcon, setActivePickerIcon] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manualFileInputRef = useRef<HTMLInputElement>(null);
  const [manualFileMappings, setManualFileMappings] = useState<Record<string, string>>({});
  const [manualFiles, setManualFiles] = useState<{ name: string; path: string; content: string; icons: IconGroup[] }[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const filesWithIcons = useMemo(() => {
    const result: { name: string; path: string; content: string; icons: IconGroup[] }[] = [];
    if (projectFiles && projectFiles.size > 0) {
      projectFiles.forEach((content, path) => {
        const icons = extractIconGroups(content);
        if (icons.length > 0) {
          result.push({ name: path.split('/').pop() || path, path, content, icons });
        }
      });
    }
    return [...result, ...manualFiles];
  }, [projectFiles, manualFiles]);

  const selectedFileInfo = selectedFile ? filesWithIcons.find(f => f.path === selectedFile) : null;

  const filteredFiles = searchQuery
    ? filesWithIcons.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.path.toLowerCase().includes(searchQuery.toLowerCase()))
    : filesWithIcons;

  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath);
    setEditingIcons({});
  };

  const handleIconChange = (localName: string, newName: string) => {
    setEditingIcons(prev => ({ ...prev, [localName]: { ...(prev[localName] || { isPng: false, pngPath: '' }), newName } }));
  };

  const handleTogglePng = (localName: string, isPng: boolean) => {
    setEditingIcons(prev => ({ ...prev, [localName]: { ...(prev[localName] || { newName: localName, pngPath: '' }), isPng } }));
  };

  const handlePngPathChange = (localName: string, pngPath: string) => {
    setEditingIcons(prev => ({ ...prev, [localName]: { ...(prev[localName] || { newName: localName, isPng: true }), pngPath } }));
  };

  const openFilePicker = (localName: string) => {
    setActivePickerIcon(localName);
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activePickerIcon) return;

    const currentIcon = activePickerIcon;
    const targetPngPath = `/icons/${file.name}`;
    const isRemoteProject = projectPath?.startsWith('database:') || projectPath?.startsWith('github:') || projectPath?.startsWith('zeus:');

    const applyIconChange = () => {
      const objectUrl = URL.createObjectURL(file);
      setLocalPngUrls(prev => ({ ...prev, [currentIcon]: objectUrl }));
      setEditingIcons(prev => ({
        ...prev,
        [currentIcon]: {
          ...(prev[currentIcon] || { newName: currentIcon }),
          isPng: true,
          pngPath: targetPngPath,
        },
      }));
    };

    if (!isRemoteProject && projectPath) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        if (!dataUrl) {
          setActivePickerIcon(null);
          return;
        }

        const normalizedProjectPath = projectPath.replace(/[\\/]+$/, '');
        const isWindows = normalizedProjectPath.includes(':\\');
        const sep = isWindows ? '\\' : '/';
        const absolutePath = `${normalizedProjectPath}${sep}public${sep}icons${sep}${file.name}`;

        try {
          const response = await sessionFetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: absolutePath,
              content: dataUrl,
            }),
          });

          const result = await response.json();
          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al guardar icono');
          }

          toast.success(t('iconSavedInPath').replace('{path}', `public/icons/${file.name}`));
          applyIconChange();
        } catch (error: any) {
          console.error('[FileIconEditor] Error subiendo icono:', error);
          toast.error(`${t('errorSavingIcon')}: ${error.message}`);
        } finally {
          setActivePickerIcon(null);
          e.target.value = '';
        }
      };
      reader.readAsDataURL(file);
    } else {
      applyIconChange();
      setActivePickerIcon(null);
      e.target.value = '';
    }
  };

  const handleManualFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const path = `manual://${file.name}`;
      const icons = extractIconGroups(content);

      if (icons.length === 0) {
        toast.info(t('noIconsInFile').replace('{fileName}', file.name));
        return;
      }

      setManualFiles(prev => {
        const filtered = prev.filter(f => f.path !== path);
        return [...filtered, { name: file.name, path, content, icons }];
      });

      const autoFound = Array.from(projectFiles.keys()).find(p => p.endsWith(file.name));
      setManualFileMappings(prev => ({
        ...prev,
        [path]: autoFound || ''
      }));

      setSelectedFile(path);
      setEditingIcons({});
      toast.success(t('fileLoadedWithIcons').replace('{fileName}', file.name).replace('{count}', icons.length.toString()));
    };
    reader.readAsText(file);

    e.target.value = '';
  };

  const getEffectiveName = (localName: string) => editingIcons[localName]?.newName ?? localName;
  const getEffectiveIsPng = (localName: string) => {
    if (editingIcons[localName]?.isPng !== undefined) return editingIcons[localName].isPng;
    const iconInfo = selectedFileInfo?.icons.find(i => i.localName === localName);
    return iconInfo?.source === 'custom-png';
  };
  const getEffectivePngPath = (localName: string) => {
    if (editingIcons[localName]?.pngPath !== undefined) return editingIcons[localName].pngPath;
    const iconInfo = selectedFileInfo?.icons.find(i => i.localName === localName);
    return iconInfo?.pngPath || '';
  };
  const isEdited = (localName: string) => {
    const edit = editingIcons[localName];
    if (!edit) return false;
    return (edit.newName !== undefined && edit.newName !== localName) || edit.isPng || (edit.pngPath && edit.pngPath.length > 0);
  };

  const handleSaveFile = async () => {
    if (!selectedFileInfo || isSaving) return;

    const changed = Object.entries(editingIcons).filter(([localName, edit]) => {
      return edit.newName !== localName || edit.isPng || edit.pngPath;
    });

    if (changed.length === 0) {
      toast.info(t('noChangesToSave'));
      return;
    }

    // Resolver path real si es un archivo cargado manualmente
    let realFilePath = selectedFileInfo.path;
    if (selectedFileInfo.path.startsWith('manual://')) {
      const mapping = manualFileMappings[selectedFileInfo.path];
      if (mapping && mapping.trim()) {
        realFilePath = mapping.trim();
      } else {
        toast.error(t('specifyRealPathBeforeSaving'));
        return;
      }
    }

    setIsSaving(true);
    try {
      let newContent = selectedFileInfo.content;

      for (const [localName, edit] of changed) {
        // Determinar el source del icono (lucide-react o @heroicons/react)
        const iconInfo = selectedFileInfo.icons.find(i => i.localName === localName);
        const source = iconInfo?.source || 'lucide-react';
        const sourcePattern = source === '@heroicons/react'
          ? '@heroicons/react[^\'"]*'
          : 'lucide-react';

        if (edit.isPng && edit.pngPath) {
          if (iconInfo?.source === 'custom-png') {
            // Icono ya era PNG: solo actualizar src si cambió
            if (edit.pngPath !== iconInfo.pngPath) {
              // Primero intentar por data-icon-name (archivos guardados tras este cambio)
              const imgWithDataRegex = new RegExp(`<img\\b[^>]*data-icon-name="${localName}"[^>]*>`, 'g');
              if (newContent.match(imgWithDataRegex)) {
                newContent = newContent.replace(imgWithDataRegex, (match) => {
                  return match.replace(/src=["'][^"']+["']/, `src="${edit.pngPath}"`);
                });
              } else if (iconInfo.pngPath) {
                // Fallback: buscar por src antiguo (archivos guardados antes de este cambio)
                const escapedSrc = iconInfo.pngPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const imgBySrcRegex = new RegExp(`<img\\b[^>]*src=["']${escapedSrc}["'][^>]*>`, 'g');
                newContent = newContent.replace(imgBySrcRegex, (match) => {
                  return match.replace(/src=["'][^"']+["']/, `src="${edit.pngPath}"`);
                });
              }
            }
          } else {
            // Modo PNG desde icono de librería: eliminar del import y reemplazar JSX por <img>
            // 1. Eliminar del import de forma robusta (parsear lista de nombres)
            const fullImportRegex = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${sourcePattern}['"];?`, 'g');
            const importMatches = Array.from(newContent.matchAll(fullImportRegex));
            for (let i = importMatches.length - 1; i >= 0; i--) {
              const m = importMatches[i];
              const fullImportStr = m[0];
              const namesStr = m[1];
              const matchIdx = m.index!;

              const names = namesStr.split(',').map(n => n.trim()).filter(Boolean);
              const filteredNames = names.filter(n => {
                const parts = n.split(/\s+as\s+/);
                const importedName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
                return importedName !== localName;
              });

              if (filteredNames.length === 0) {
                // Borrar toda la línea del import
                const endIdx = matchIdx + fullImportStr.length;
                const extra = newContent[endIdx] === '\n' ? 1 : 0;
                newContent = newContent.slice(0, matchIdx) + newContent.slice(endIdx + extra);
              } else {
                const importSource = source === '@heroicons/react' ? '@heroicons/react/24/outline' : 'lucide-react';
                const newImport = `import { ${filteredNames.join(', ')} } from '${importSource}';`;
                newContent = newContent.slice(0, matchIdx) + newImport + newContent.slice(matchIdx + fullImportStr.length);
              }
            }

            // 2. Reemplazar usos JSX <LocalName ... /> por <img ... />
            const selfClosingRegex = new RegExp(`<${localName}\\b(?:\\s+(?:[\\w-]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\}))?)?)*\\s*\\/>`, 'g');
            const selfClosingMatches = newContent.match(selfClosingRegex);
            console.log(`[FileIconEditor] 🔍 Reemplazando self-closing ${localName}: ${selfClosingMatches?.length || 0} ocurrencias`);
            newContent = newContent.replace(selfClosingRegex, `<img src="${edit.pngPath}" data-icon-name="${localName}" alt="icon" width={24} height={24} className="inline-block" />`);

            // 3. Reemplazar <LocalName>...</LocalName> por <img ... />
            const withChildrenRegex = new RegExp(`<${localName}\\b[^>]*>(.*?)</${localName}>`, 'gs');
            const withChildrenMatches = newContent.match(withChildrenRegex);
            console.log(`[FileIconEditor] 🔍 Reemplazando con hijos ${localName}: ${withChildrenMatches?.length || 0} ocurrencias`);
            newContent = newContent.replace(withChildrenRegex, `<img src="${edit.pngPath}" data-icon-name="${localName}" alt="icon" width={24} height={24} className="inline-block" />`);
          }
        } else if (edit.newName && edit.newName !== localName) {
          // Cambio de nombre: reemplazar en import + todos los JSX
          // 1. Reemplazar en import
          const importRegex = new RegExp(`(import\\s*\\{[^}]*?)\\b${localName}\\b([^}]*\\}\\s*from\\s*['"]${sourcePattern}['"])`, 'g');
          newContent = newContent.replace(importRegex, `$1${edit.newName}$2`);

          // 2. Reemplazar tags JSX abiertos <LocalName por <NewName
          const openTagRegex = new RegExp(`<${localName}\\b`, 'g');
          newContent = newContent.replace(openTagRegex, `<${edit.newName}`);

          // 3. Reemplazar tags JSX cerrados </LocalName> por </NewName>
          const closeTagRegex = new RegExp(`</${localName}>`, 'g');
          newContent = newContent.replace(closeTagRegex, `</${edit.newName}>`);
        }
      }

      const success = await onSaveFile(realFilePath, newContent);
      if (success) {
        toast.success(t('fileUpdatedSuccessfully').replace('{fileName}', selectedFileInfo.name));
        setEditingIcons({});
        if (onRefreshFiles) await onRefreshFiles();
      } else {
        toast.error(t('errorSavingFile').replace('{fileName}', selectedFileInfo.name));
      }
    } catch (error) {
      console.error('[FileIconEditor] Error:', error);
      toast.error(t('errorSaving'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full border-r bg-card overflow-hidden max-w-full">
      {/* Header */}
      <div className="p-4 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground/80">{t('iconEditorTitle')}</h2>
          <div className="flex items-center text-sm text-muted-foreground">
            <Smile className="h-4 w-4 mr-1" />
            <span>{filesWithIcons.reduce((acc, f) => acc + f.icons.length, 0)} {t('iconsCount')}</span>
          </div>
        </div>

        <div className="mb-3 flex gap-2">
          <Select value={selectedFile || ''} onValueChange={handleFileSelect}>
            <SelectTrigger className="bg-muted border-border/40 text-foreground/80 flex-1">
              <SelectValue placeholder={t('selectFile')} />
            </SelectTrigger>
            <SelectContent className="bg-muted border-border/40">
              {filteredFiles.map(file => (
                <SelectItem key={file.path} value={file.path} className="text-foreground/80 hover:bg-muted/80">
                  <div className="flex items-center">
                    <File className="h-4 w-4 mr-2 text-accent shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate max-w-[180px]">{file.name}</span>
                      <span className="text-[10px] text-muted-foreground/80 truncate max-w-[180px]">{file.path}</span>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">({file.icons.length})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            title={t('loadFileManually')}
            onClick={() => manualFileInputRef.current?.click()}
            className="border-border/40 text-foreground/70 hover:bg-muted shrink-0"
          >
            <Upload className="h-4 w-4" />
          </Button>
          <input
            ref={manualFileInputRef}
            type="file"
            accept=".tsx,.jsx,.ts,.js"
            className="hidden"
            onChange={handleManualFileUpload}
          />
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchFilesPlaceholder' as any)}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 bg-muted border-border/40 text-foreground/80"
          />
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 bg-card overflow-auto">
        {filesWithIcons.length === 0 ? (
          <div className="text-center py-12 px-4 text-muted-foreground">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground/60" />
            <p className="text-base font-semibold mb-2 text-foreground/70">{t('noIconsFound')}</p>
            <p className="text-sm text-muted-foreground/80 mb-4">{t('loadProjectToSearchIcons')}</p>
            <Button
              variant="outline"
              onClick={() => manualFileInputRef.current?.click()}
              className="border-border/40 text-foreground/70 hover:bg-muted"
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('loadFileManually')}
            </Button>
          </div>
        ) : selectedFileInfo ? (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-medium text-foreground/80 flex items-center">
                  <File className="h-5 w-5 mr-2 text-accent" />
                  {selectedFileInfo.name}
                </h3>
                <p className="text-sm text-muted-foreground">{selectedFileInfo.icons.length} {t('iconsFoundInFile')}</p>

                {/* Input de mapeo para archivos manuales */}
                {selectedFileInfo.path.startsWith('manual://') && (
                  <div className="mt-2">
                    <label className="block text-xs text-warning mb-1">
                      {t('realProjectPathLabel')}
                    </label>
                    <input
                      type="text"
                      value={manualFileMappings[selectedFileInfo.path] || ''}
                      onChange={(e) => {
                        setManualFileMappings(prev => ({
                          ...prev,
                          [selectedFileInfo.path]: e.target.value
                        }));
                      }}
                      placeholder="app/page.tsx"
                      className="w-full bg-background border border-yellow-600/50 text-foreground/80 font-mono text-sm p-2 rounded"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2 self-start">
                <Button
                  onClick={handleSaveFile}
                  disabled={isSaving || Object.keys(editingIcons).length === 0}
                  className="bg-accent hover:bg-purple-700"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? t('saving' as any) : t('save')}
                </Button>
                {Object.keys(editingIcons).length > 0 && (
                  <Button variant="outline" onClick={() => setEditingIcons({})} className="border-border/40 text-foreground/70 hover:bg-muted">
                    {t('cancel')}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {selectedFileInfo.icons.map(icon => {
                const edited = isEdited(icon.localName);
                const currentName = getEffectiveName(icon.localName);
                const isPng = getEffectiveIsPng(icon.localName);
                const pngPath = getEffectivePngPath(icon.localName);

                return (
                  <div
                    key={icon.localName}
                    className={cn(
                      "border rounded-lg p-3 bg-muted/50 border-border/40",
                      edited && "border-yellow-500/50 bg-warning/10"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Preview */}
                      <div className="flex-shrink-0">
                        <div className="w-16 h-16 flex items-center justify-center rounded-lg border border-border/30 bg-muted/80 p-2">
                          <div className="w-12 h-12 flex items-center justify-center rounded bg-card">
                            {getIconPreview(currentName, icon.source, icon.pngPath, devServerUrl)}
                          </div>
                        </div>
                      </div>

                      {/* Controles */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">{t('line')} {icon.line}</span>
                          <span className="text-xs text-muted-foreground/80">({icon.count} {t('uses')})</span>
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-medium",
                            icon.source === '@heroicons/react'
                              ? "bg-sky-500/20 text-sky-300"
                              : icon.source === 'custom-png'
                                ? "bg-orange-500/20 text-orange-300"
                                : "bg-accent/20 text-purple-300"
                          )}>
                            {icon.source === '@heroicons/react' ? 'Heroicons' : icon.source === 'custom-png' ? 'PNG' : 'Lucide'}
                          </span>
                          {edited && <span className="text-xs bg-warning/20 text-yellow-300 px-2 py-0.5 rounded">{t('edited')}</span>}
                        </div>

                        <div className="mb-2">
                          <label className="text-xs text-muted-foreground">{t('name')}</label>
                          <Input
                            value={currentName}
                            onChange={e => handleIconChange(icon.localName, e.target.value)}
                            disabled={isPng || icon.source === 'custom-png'}
                            className="bg-background border-border/40 text-foreground/80 font-mono text-sm mt-1"
                            placeholder={t('iconNamePlaceholder')}
                          />
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer mb-2">
                          <input
                            type="checkbox"
                            checked={isPng}
                            disabled={icon.source === 'custom-png'}
                            onChange={e => handleTogglePng(icon.localName, e.target.checked)}
                            className="rounded border-border/40 bg-muted text-purple-600"
                          />
                          <span className="text-sm text-foreground/70">{t('replaceWithPng')}</span>
                        </label>

                        {isPng && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <Input
                                value={pngPath}
                                onChange={e => handlePngPathChange(icon.localName, e.target.value)}
                                className="bg-background border-border/40 text-foreground/80 font-mono text-sm flex-1"
                                placeholder="/icons/mi-icono.png"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openFilePicker(icon.localName)}
                                className="border-border/40 text-foreground/70 hover:bg-muted shrink-0"
                              >
                                <ImageIcon className="h-4 w-4 mr-1" />
                                {t('browse')}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground/80">{t('relativePathFromPublic')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="space-y-2">
              {filteredFiles.map(file => (
                <div
                  key={file.path}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40 cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedFile(file.path)}
                >
                  <div className="flex items-center">
                    <File className="h-4 w-4 mr-3 text-accent" />
                    <div>
                      <div className="font-medium text-foreground/80">{file.name}</div>
                      <div className="text-xs text-muted-foreground">{file.path}</div>
                    </div>
                  </div>
                  <span className="bg-accent/20 text-purple-300 text-xs px-2 py-1 rounded-full">{file.icons.length} {t('iconsCount')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border/50 text-xs text-muted-foreground bg-background">
        {filesWithIcons.length} {t('filesWithIcons')}
      </div>

      {/* Input file oculto para seleccionar PNG */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png"
        className="hidden"
        onChange={handleFileSelected}
      />
    </div>
  );
}
